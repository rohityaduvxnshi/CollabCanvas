/**
 * Postgres snapshot persistence (Phase 3).
 *
 *  - On the FIRST client joining a room, load `BoardSnapshot.state` and apply it
 *    to the shared doc (async — late-arriving updates broadcast like any edit).
 *  - On doc updates, save debounced (idle flush) — never on every keystroke.
 *  - Flush immediately when the last client disconnects.
 *
 * If DATABASE_URL is unset the server runs memory-only (Phase 1/2 behavior) and
 * says so once at startup — dev/test convenience, and honest about it.
 */

import * as Y from "yjs";
import { getPrisma } from "@collabcanvas/db";
import { log } from "./log";

const DEBOUNCE_MS = 3000;
/** Under sustained editing a pure trailing-edge debounce would NEVER flush
 *  (every update re-arms the timer) — cap how long a write can be deferred. */
const MAX_WAIT_MS = 10_000;

export const persistenceEnabled = Boolean(process.env.DATABASE_URL);

/** Transaction origin for snapshot loads — lets the sync layer skip re-saving
 *  the state it just read from the database. */
export const ORIGIN_SNAPSHOT_LOAD = "snapshot-load";

/** Room names are `board:<id>`; snapshots key on the bare board id. */
const boardIdForRoom = (room: string): string =>
  room.startsWith("board:") ? room.slice("board:".length) : room;

/**
 * Load a room's snapshot into its doc. Returns whether it is SAFE to write
 * snapshots for this room later: true when the snapshot was applied (or none
 * exists), false when the load ERRORED — in that case the in-memory doc may be
 * missing real content, and persisting it would overwrite good data with a
 * partial/empty state. All write paths are gated on this result.
 */
export async function loadSnapshot(room: string, doc: Y.Doc): Promise<boolean> {
  if (!persistenceEnabled) return true;
  try {
    const row = await getPrisma().boardSnapshot.findUnique({
      where: { boardId: boardIdForRoom(room) },
    });
    if (row) {
      Y.applyUpdate(doc, new Uint8Array(row.state), ORIGIN_SNAPSHOT_LOAD);
      log.info("snapshot loaded", { room, bytes: row.state.length });
    }
    return true;
  } catch (err) {
    log.error("snapshot load failed — writes disabled for this room", {
      room,
      err: String(err),
    });
    return false;
  }
}

/** Writes currently in flight — shutdown awaits these so a detached flush
 *  (e.g. from a last-client disconnect) can't be cut off by process.exit. */
const inFlightWrites = new Set<Promise<unknown>>();

export async function awaitInFlightWrites(): Promise<void> {
  await Promise.allSettled(Array.from(inFlightWrites));
}

async function writeSnapshot(room: string, doc: Y.Doc): Promise<void> {
  const state = Buffer.from(Y.encodeStateAsUpdate(doc));
  const boardId = boardIdForRoom(room);
  const write = getPrisma().boardSnapshot.upsert({
    where: { boardId },
    create: { boardId, state },
    update: { state },
  });
  inFlightWrites.add(write);
  try {
    await write;
  } finally {
    inFlightWrites.delete(write);
  }
  log.info("snapshot saved", { room, bytes: state.length });
}

interface PendingWrite {
  timer: ReturnType<typeof setTimeout>;
  /** When this burst of edits FIRST scheduled a write (for the max-wait cap). */
  since: number;
}
const timers = new Map<string, PendingWrite>();

/** A snapshot write for a board with no Board row (Prisma P2003, FK violation)
 *  means the board was deleted — dropping the snapshot is correct, not an error. */
const isMissingBoard = (err: unknown): boolean =>
  (err as { code?: string } | null)?.code === "P2003";

function logSaveError(room: string, err: unknown): void {
  if (isMissingBoard(err)) {
    log.warn("board row gone — snapshot skipped", { room });
  } else {
    log.error("snapshot save failed", { room, err: String(err) });
  }
}

/** Debounced save with a max-wait: writes DEBOUNCE_MS after the last edit, but
 *  never defers more than MAX_WAIT_MS past the burst's first edit. */
export function scheduleSnapshot(room: string, doc: Y.Doc): void {
  if (!persistenceEnabled) return;
  const pending = timers.get(room);
  const since = pending?.since ?? Date.now();
  if (pending) clearTimeout(pending.timer);

  if (Date.now() - since >= MAX_WAIT_MS) {
    timers.delete(room);
    writeSnapshot(room, doc).catch((err) => logSaveError(room, err));
    return;
  }
  timers.set(room, {
    since,
    timer: setTimeout(() => {
      timers.delete(room);
      writeSnapshot(room, doc).catch((err) => logSaveError(room, err));
    }, DEBOUNCE_MS),
  });
}

/** Immediate flush (last client left, or shutdown). Cancels any pending timer.
 *  Returns whether the write actually landed (false = error, logged). */
export async function flushSnapshot(room: string, doc: Y.Doc): Promise<boolean> {
  if (!persistenceEnabled) return true;
  const pending = timers.get(room);
  if (pending) {
    clearTimeout(pending.timer);
    timers.delete(room);
  }
  try {
    await writeSnapshot(room, doc);
    return true;
  } catch (err) {
    logSaveError(room, err);
    return false;
  }
}
