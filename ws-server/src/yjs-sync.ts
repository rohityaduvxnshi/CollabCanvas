/**
 * Yjs sync + awareness handler for the WebSocket server.
 *
 * NOTE (verified against installed versions): y-websocket v3 no longer ships a
 * server helper (`bin/utils.js` / `setupWSConnection` is gone). So this file is
 * the reference server handler, re-implemented over the `ws` package using
 * `y-protocols` (sync + awareness) and `lib0` (encoding/decoding) — exactly the
 * wire protocol the v3 client `WebsocketProvider` speaks:
 *   messageSync = 0, messageAwareness = 1.
 *
 * Rooms are in-memory (Phase 1). Phase 3 loads/saves a Postgres snapshot per
 * room; Phase 4 adds per-connection role enforcement.
 */

import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import * as map from "lib0/map";
import type { WebSocket, RawData } from "ws";
import {
  flushSnapshot,
  loadSnapshot,
  ORIGIN_SNAPSHOT_LOAD,
  persistenceEnabled,
  scheduleSnapshot,
} from "./persistence";
import { log } from "./log";

const messageSync = 0;
const messageAwareness = 1;

const wsReadyStateConnecting = 0;
const wsReadyStateOpen = 1;

const pingTimeout = 30000;

/** Oversized-payload guard (Phase 6). A legit message is a Yjs delta or a full
 *  state exchange — even big boards stay well under this. Anything larger is
 *  hostile or broken: drop the connection. */
const MAX_MESSAGE_BYTES = 1_000_000;

/** All live in-memory rooms, keyed by room/doc name. */
const docs = new Map<string, WSSharedDoc>();

/** During shutdown, closeConn's per-room flush+evict must stand down: it would
 *  race flushAllRooms on the same doc (two upserts, one possibly encoding an
 *  already-destroyed doc → empty snapshot clobbers the good write). */
let shuttingDown = false;
export function markShuttingDown(): void {
  shuttingDown = true;
}

interface AwarenessChange {
  added: number[];
  updated: number[];
  removed: number[];
}

/** One shared Yjs doc per room, tracking its connections and awareness. */
export class WSSharedDoc extends Y.Doc {
  name: string;
  /** conn -> set of awareness client ids controlled by that conn. */
  conns: Map<WebSocket, Set<number>>;
  awareness: awarenessProtocol.Awareness;
  /**
   * Resolves once the initial Postgres snapshot load settled; the value says
   * whether snapshot WRITES are safe (false = the load errored, so persisting
   * this doc could overwrite real data with a partial/empty state). EVERY
   * write path must await this — flushing an empty just-created doc over the
   * stored snapshot was a confirmed data-wipe bug (Phase 6 review).
   */
  snapshotLoaded: Promise<boolean> = Promise.resolve(true);

  constructor(name: string) {
    super({ gc: true });
    this.name = name;
    this.conns = new Map();

    this.awareness = new awarenessProtocol.Awareness(this);
    this.awareness.setLocalState(null);

    const awarenessChangeHandler = (
      { added, updated, removed }: AwarenessChange,
      origin: unknown,
    ) => {
      const changedClients = added.concat(updated, removed);
      const conn = origin as WebSocket | null;
      if (conn !== null) {
        const controlled = this.conns.get(conn);
        if (controlled !== undefined) {
          added.forEach((clientId) => controlled.add(clientId));
          removed.forEach((clientId) => controlled.delete(clientId));
        }
      }
      // Broadcast the awareness delta to every connection in the room.
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, messageAwareness);
      encoding.writeVarUint8Array(
        encoder,
        awarenessProtocol.encodeAwarenessUpdate(this.awareness, changedClients),
      );
      const buff = encoding.toUint8Array(encoder);
      this.conns.forEach((_, conn2) => send(this, conn2, buff));
    };
    this.awareness.on("update", awarenessChangeHandler);

    // Broadcast every doc update to every connection in the room, and schedule
    // a debounced snapshot write (skipped for the initial snapshot load itself,
    // and deferred until that load settled so a half-loaded doc is never saved).
    this.on("update", (update: Uint8Array, origin: unknown) => {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, messageSync);
      syncProtocol.writeUpdate(encoder, update);
      const message = encoding.toUint8Array(encoder);
      this.conns.forEach((_, conn) => send(this, conn, message));
      if (origin !== ORIGIN_SNAPSHOT_LOAD) {
        void this.snapshotLoaded.then((ok) => {
          if (ok) scheduleSnapshot(this.name, this);
        });
      }
    });
  }
}

/** Get (or lazily create) the shared doc for a room. */
function getYDoc(docName: string): WSSharedDoc {
  return map.setIfUndefined(docs, docName, () => {
    const doc = new WSSharedDoc(docName);
    docs.set(docName, doc);
    // Load the persisted snapshot asynchronously: the sync protocol is fine
    // with late-arriving state — it broadcasts to connected clients like any
    // other update. The promise gates every snapshot WRITE for this room.
    doc.snapshotLoaded = loadSnapshot(docName, doc);
    return doc;
  });
}

function send(doc: WSSharedDoc, conn: WebSocket, message: Uint8Array): void {
  if (
    conn.readyState !== wsReadyStateConnecting &&
    conn.readyState !== wsReadyStateOpen
  ) {
    closeConn(doc, conn);
    return;
  }
  try {
    conn.send(message, (err?: Error) => {
      if (err != null) closeConn(doc, conn);
    });
  } catch {
    closeConn(doc, conn);
  }
}

function closeConn(doc: WSSharedDoc, conn: WebSocket): void {
  const controlledIds = doc.conns.get(conn);
  if (controlledIds !== undefined) {
    doc.conns.delete(conn);
    awarenessProtocol.removeAwarenessStates(
      doc.awareness,
      Array.from(controlledIds),
      null,
    );
    if (doc.conns.size === 0 && persistenceEnabled && !shuttingDown) {
      // Last client left: flush the snapshot now, then evict the doc from
      // memory (bounds memory; next join reloads from Postgres). Only evict if
      // the room is still empty once the flush lands — a client may have joined
      // meanwhile. The flush WAITS for the initial snapshot load (a client that
      // dies mid-handshake must never flush the still-empty doc over the real
      // snapshot) and is skipped entirely if that load errored.
      void doc.snapshotLoaded.then(async (ok) => {
        if (ok) await flushSnapshot(doc.name, doc);
        if (docs.get(doc.name) === doc && doc.conns.size === 0) {
          docs.delete(doc.name);
          doc.destroy();
        }
      });
    }
  }
  try {
    conn.close();
  } catch {
    // already closed
  }
}

function messageListener(
  conn: WebSocket,
  doc: WSSharedDoc,
  message: Uint8Array,
  readOnly: boolean,
): void {
  try {
    const encoder = encoding.createEncoder();
    const decoder = decoding.createDecoder(message);
    const messageType = decoding.readVarUint(decoder);
    switch (messageType) {
      case messageSync: {
        // Server-side read-only enforcement (spec §5): a viewer's syncStep2 /
        // update messages MUTATE the doc — drop them before they're applied,
        // so a tampered client still can't write. syncStep1 is a read (the
        // server replies with its state) and stays allowed.
        if (readOnly) {
          const syncMessageType = decoding.peekVarUint(decoder);
          if (
            syncMessageType === syncProtocol.messageYjsSyncStep2 ||
            syncMessageType === syncProtocol.messageYjsUpdate
          ) {
            return;
          }
        }
        encoding.writeVarUint(encoder, messageSync);
        syncProtocol.readSyncMessage(decoder, encoder, doc, conn);
        // readSyncMessage may have written a reply (e.g. syncStep2). Only send
        // if there's content beyond the 1-byte messageSync header.
        if (encoding.length(encoder) > 1) {
          send(doc, conn, encoding.toUint8Array(encoder));
        }
        break;
      }
      case messageAwareness:
        // Presence (cursors, editing badges) is not a doc mutation — allowed
        // for viewers too.
        awarenessProtocol.applyAwarenessUpdate(
          doc.awareness,
          decoding.readVarUint8Array(decoder),
          conn,
        );
        break;
      default:
        break;
    }
  } catch (err) {
    log.error("message handling error", { room: doc.name, err: String(err) });
  }
}

/** Flush every live room's snapshot — used by graceful shutdown (SIGTERM).
 *  Awaits each room's initial load first (never persist a half-loaded doc)
 *  and reports failures honestly. */
export async function flushAllRooms(): Promise<{ flushed: number; failed: number }> {
  const rooms = Array.from(docs.entries());
  let flushed = 0;
  let failed = 0;
  await Promise.all(
    rooms.map(async ([name, doc]) => {
      if (!(await doc.snapshotLoaded)) {
        failed++; // load never succeeded — skipping is the safe outcome
        return;
      }
      if (await flushSnapshot(name, doc)) flushed++;
      else failed++;
    }),
  );
  return { flushed, failed };
}

/** Live room count (health endpoint). */
export const liveRoomCount = (): number => docs.size;

/**
 * Wire up a freshly-accepted WebSocket to its room's shared doc.
 * `docName` is the room name (derived from the connection URL by the caller).
 * `readOnly` connections (viewers) get their document-mutating messages dropped.
 */
export function setupWSConnection(
  conn: WebSocket,
  docName: string,
  { readOnly = false }: { readOnly?: boolean } = {},
): void {
  conn.binaryType = "arraybuffer";
  const doc = getYDoc(docName);
  doc.conns.set(conn, new Set());

  // Without an 'error' listener, ANY socket error on a live connection (TCP
  // reset, or ws itself rejecting a frame over maxPayload) is an unhandled
  // 'error' event → uncaughtException → the whole server dies.
  conn.on("error", (err: Error) => {
    log.warn("connection error", { room: docName, err: String(err) });
    closeConn(doc, conn);
  });

  conn.on("message", (message: RawData) => {
    const bytes = new Uint8Array(message as ArrayBuffer);
    if (bytes.byteLength > MAX_MESSAGE_BYTES) {
      // Belt to wss maxPayload's suspenders — ws normally rejects these first.
      log.warn("oversized message — closing connection", {
        room: docName,
        bytes: bytes.byteLength,
      });
      closeConn(doc, conn);
      return;
    }
    messageListener(conn, doc, bytes, readOnly);
  });

  // Keepalive: ping periodically; drop the connection if a pong never comes.
  let pongReceived = true;
  const pingInterval = setInterval(() => {
    if (!pongReceived) {
      if (doc.conns.has(conn)) closeConn(doc, conn);
      clearInterval(pingInterval);
    } else if (doc.conns.has(conn)) {
      pongReceived = false;
      try {
        conn.ping();
      } catch {
        closeConn(doc, conn);
        clearInterval(pingInterval);
      }
    }
  }, pingTimeout);

  conn.on("pong", () => {
    pongReceived = true;
  });
  conn.on("close", () => {
    closeConn(doc, conn);
    clearInterval(pingInterval);
  });

  // Kick off the sync handshake: send our sync step 1...
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, messageSync);
  syncProtocol.writeSyncStep1(encoder, doc);
  send(doc, conn, encoding.toUint8Array(encoder));

  // ...and the current awareness states, if any.
  const states = doc.awareness.getStates();
  if (states.size > 0) {
    const awarenessEncoder = encoding.createEncoder();
    encoding.writeVarUint(awarenessEncoder, messageAwareness);
    encoding.writeVarUint8Array(
      awarenessEncoder,
      awarenessProtocol.encodeAwarenessUpdate(
        doc.awareness,
        Array.from(states.keys()),
      ),
    );
    send(doc, conn, encoding.toUint8Array(awarenessEncoder));
  }
}
