/**
 * Phase 3 headless persistence harness. Two modes, orchestrated externally
 * (the server is killed/restarted between them):
 *
 *   npx tsx scripts/phase3-persistence.ts write <room>
 *     Connect, make a burst of edits, wait past the debounce so the snapshot
 *     lands, disconnect (triggers flush + evict).
 *
 *   npx tsx scripts/phase3-persistence.ts verify <room>
 *     Connect fresh (after a server restart) and assert the exact board state
 *     came back from Postgres.
 */

import * as Y from "yjs";
import { WebSocket as WsWebSocket } from "ws";
import { WebsocketProvider } from "y-websocket";
import { createBoardActions } from "../web/lib/yjs/mutations";
import { deriveBoardView } from "../web/lib/yjs/deriveBoardView";
import { mintEditorToken } from "./mintToken";

/**
 * Since Phase 4, BoardSnapshot has a FK to Board — the server (correctly)
 * refuses snapshots for boards that don't exist in the DB. The harness must
 * therefore create real User+Board rows for its room before writing.
 */
async function ensureBoardRow(boardId: string): Promise<void> {
  const { getPrisma } = await import("../packages/db/src/index");
  const prisma = getPrisma();
  const user = await prisma.user.upsert({
    where: { email: "harness@test.local" },
    create: { email: "harness@test.local", name: "Harness" },
    update: {},
  });
  await prisma.board.upsert({
    where: { id: boardId },
    create: { id: boardId, title: "Harness board", ownerId: user.id },
    update: {},
  });
}

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:4000";
const [, , mode, room] = process.argv;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function connect(roomName: string) {
  const doc = new Y.Doc();
  const token = await mintEditorToken(roomName);
  const provider = new WebsocketProvider(WS_URL, roomName, doc, {
    disableBc: true,
    WebSocketPolyfill: WsWebSocket as unknown as typeof WebSocket,
    ...(token ? { params: { token } } : {}),
  });
  return { doc, provider };
}

function waitSynced(provider: WebsocketProvider): Promise<void> {
  if (provider.synced) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const onSync = (s: boolean) => {
      if (s) {
        provider.off("sync", onSync);
        resolve();
      }
    };
    provider.on("sync", onSync);
  });
}

async function write() {
  await ensureBoardRow(room.startsWith("board:") ? room.slice(6) : room);
  const { doc, provider } = await connect(room);
  await waitSynced(provider);
  const actions = createBoardActions(doc);

  actions.addColumn("Persisted");
  await sleep(150);
  const colId = deriveBoardView(doc).columns[0].id;
  // Burst of rapid edits — the server must debounce these into few writes.
  for (let i = 1; i <= 10; i++) actions.addCard(colId, `Card ${i}`);
  await sleep(200);

  const view = deriveBoardView(doc);
  console.log(
    `wrote: ${view.columns.length} column(s), ${view.columns[0].cards.length} cards`,
  );

  // Outlive the 3s debounce so the snapshot lands while we're connected.
  await sleep(4500);
  provider.destroy();
  doc.destroy();
  await sleep(500); // let the server's last-disconnect flush run
  console.log("write phase done");
  process.exit(0);
}

async function verify() {
  const { doc, provider } = await connect(room);
  await waitSynced(provider);
  // Snapshot load is async server-side; give the late update a moment.
  await sleep(1200);

  const view = deriveBoardView(doc);
  const col = view.columns[0];
  const ok =
    view.columns.length === 1 &&
    col?.title === "Persisted" &&
    col?.cards.length === 10 &&
    col.cards.every((c, i) => c.title === `Card ${i + 1}`);

  console.log(
    `verify: ${view.columns.length} column(s), ${col?.cards.length ?? 0} cards — ${
      ok ? "STATE RESTORED ✅" : "STATE WRONG ❌"
    }`,
  );
  provider.destroy();
  doc.destroy();
  await sleep(100);
  process.exit(ok ? 0 : 1);
}

if (mode === "write") void write();
else if (mode === "verify") void verify();
else {
  console.error("usage: phase3-persistence.ts <write|verify> <room>");
  process.exit(2);
}
