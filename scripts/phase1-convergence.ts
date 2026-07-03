/**
 * Phase 1 headless convergence harness.
 *
 * Spins up TWO independent Yjs clients (BroadcastChannel disabled, so all sync
 * goes through the real WS server) and verifies the Phase 1 acceptance criteria
 * empirically:
 *   - basic add/edit/move sync between clients
 *   - concurrent move of the SAME card to DIFFERENT columns converges with no
 *     crash, no duplicate, and no lost card (the documented CRDT edge case)
 *   - concurrent edits and concurrent distinct adds converge
 *
 * Run (with the ws-server up):  npx tsx scripts/phase1-convergence.ts
 */

import * as Y from "yjs";
import { WebSocket as WsWebSocket } from "ws";
import { WebsocketProvider } from "y-websocket";
import { createBoardActions } from "../web/lib/yjs/mutations";
import { deriveBoardView } from "../web/lib/yjs/deriveBoardView";
import { mintEditorToken } from "./mintToken";
import type { BoardData } from "@collabcanvas/shared";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:4000";
const ROOM = `board:phase1-test-${Date.now()}`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

let failed = false;
function check(cond: boolean, msg: string) {
  if (cond) {
    console.log("  ✅", msg);
  } else {
    console.error("  ❌ FAIL:", msg);
    failed = true;
  }
}

function connect(room: string, token: string | null) {
  const doc = new Y.Doc();
  const provider = new WebsocketProvider(WS_URL, room, doc, {
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

const cardCount = (v: BoardData, cardId: string): number =>
  v.columns.reduce(
    (n, c) => n + c.cards.filter((x) => x.id === cardId).length,
    0,
  );

async function main() {
  console.log(`Room: ${ROOM}\nServer: ${WS_URL}\n`);
  const token = await mintEditorToken(ROOM);
  const A = connect(ROOM, token);
  const B = connect(ROOM, token);
  await Promise.all([waitSynced(A.provider), waitSynced(B.provider)]);
  console.log("Both clients connected + synced.\n");

  const a = createBoardActions(A.doc);
  const b = createBoardActions(B.doc);

  // --- 1. basic add sync A -> B ---
  a.addColumn("Todo");
  await sleep(300);
  const todoId = deriveBoardView(A.doc).columns[0].id;
  a.addCard(todoId, "Card X");
  await sleep(400);
  check(eq(deriveBoardView(A.doc), deriveBoardView(B.doc)), "basic add syncs A -> B");
  check(
    deriveBoardView(B.doc).columns[0].cards.some((c) => c.title === "Card X"),
    "B sees the card A added",
  );

  // add two more columns to move between
  a.addColumn("Doing");
  a.addColumn("Done");
  await sleep(400);
  const cols = deriveBoardView(A.doc).columns;
  check(cols.length === 3, "three columns exist");
  check(eq(deriveBoardView(A.doc), deriveBoardView(B.doc)), "columns converge A === B");
  const doing = cols[1];
  const done = cols[2];
  const cardId = cols[0].cards[0].id;

  // --- 2. concurrent move of the SAME card to DIFFERENT columns ---
  // Neither client has seen the other's move yet -> classic conflict.
  a.moveCard(cardId, doing.id, 0);
  b.moveCard(cardId, done.id, 0);
  await sleep(900);
  const va = deriveBoardView(A.doc);
  const vb = deriveBoardView(B.doc);
  check(eq(va, vb), "concurrent same-card move converges (A === B)");
  check(cardCount(va, cardId) === 1, "moved card appears exactly once (no dup, no loss)");

  // --- 3. concurrent edit of the same card title ---
  a.updateCard(cardId, { title: "Edited by A" });
  b.updateCard(cardId, { title: "Edited by B" });
  await sleep(600);
  check(
    eq(deriveBoardView(A.doc), deriveBoardView(B.doc)),
    "concurrent title edit converges (A === B)",
  );

  // --- 4. concurrent distinct adds both survive ---
  a.addCard(todoId, "A-card");
  b.addCard(todoId, "B-card");
  await sleep(700);
  const fa = deriveBoardView(A.doc);
  check(eq(fa, deriveBoardView(B.doc)), "concurrent distinct adds converge (A === B)");
  const titles = fa.columns.flatMap((c) => c.cards.map((x) => x.title));
  check(
    titles.includes("A-card") && titles.includes("B-card"),
    "both concurrently-added cards survive",
  );

  // --- 5. deleteColumn must NOT destroy a card concurrently moved out (regression) ---
  a.addColumn("Src");
  a.addColumn("Dst");
  await sleep(400);
  const cols2 = deriveBoardView(A.doc).columns;
  const src = cols2.find((c) => c.title === "Src")!;
  const dst = cols2.find((c) => c.title === "Dst")!;
  a.addCard(src.id, "Move-me-X");
  await sleep(400);
  const xId = deriveBoardView(A.doc)
    .columns.find((c) => c.id === src.id)!
    .cards.find((c) => c.title === "Move-me-X")!.id;
  check(
    eq(deriveBoardView(A.doc), deriveBoardView(B.doc)),
    "delete-vs-move setup converges",
  );

  // Concurrent: A moves X to Dst; B deletes Src (before they exchange updates).
  a.moveCard(xId, dst.id, 0);
  b.deleteColumn(src.id);
  await sleep(900);
  const da = deriveBoardView(A.doc);
  const db = deriveBoardView(B.doc);
  check(eq(da, db), "delete-column vs concurrent move converges (A === B)");
  check(cardCount(da, xId) === 1, "moved card survives column deletion (not lost)");
  const dstView = da.columns.find((c) => c.id === dst.id);
  check(
    !!dstView && dstView.cards.some((c) => c.id === xId),
    "moved card is in the destination column",
  );
  check(!da.columns.some((c) => c.id === src.id), "deleted column is gone");

  A.provider.destroy();
  B.provider.destroy();
  A.doc.destroy();
  B.doc.destroy();

  console.log(failed ? "\nRESULT: FAIL" : "\nRESULT: PASS — all convergence checks passed");
  await sleep(100);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
