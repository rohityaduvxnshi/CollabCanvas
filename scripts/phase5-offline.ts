/**
 * Phase 5 headless harness: offline persistence + replay + restore.
 *
 * Node has no IndexedDB, so `fake-indexeddb` provides one (same code path
 * y-indexeddb uses in the browser). Verifies:
 *   1. Edits persist to IndexedDB and survive a "reload" (new doc, same store)
 *      with NO network at any point.
 *   2. Reconnect replay: the offline-edited doc connects to the real WS server
 *      and a fresh online client converges to include the offline edits.
 *   3. `replaceDocFromSnapshot` hard-resets a doc to an earlier snapshot and
 *      a connected peer converges to the restored state.
 *
 * Run (ws-server up):  npx tsx scripts/phase5-offline.ts
 */

import "fake-indexeddb/auto"; // installs global indexedDB BEFORE y-indexeddb loads

import * as Y from "yjs";
import { WebSocket as WsWebSocket } from "ws";
import { WebsocketProvider } from "y-websocket";
import { IndexeddbPersistence } from "y-indexeddb";
import { createBoardActions } from "../web/lib/yjs/mutations";
import { deriveBoardView } from "../web/lib/yjs/deriveBoardView";
import { replaceDocFromSnapshot } from "../web/lib/yjs/restore";
import { mintEditorToken } from "./mintToken";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:4000";
const ROOM = `board:phase5-test-${Date.now()}`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

let failed = false;
function check(cond: boolean, msg: string) {
  if (cond) console.log("  ✅", msg);
  else {
    console.error("  ❌ FAIL:", msg);
    failed = true;
  }
}

async function connect(room: string) {
  const doc = new Y.Doc();
  const token = await mintEditorToken(room);
  const provider = new WebsocketProvider(WS_URL, room, doc, {
    disableBc: true,
    params: token ? { token } : {},
    WebSocketPolyfill: WsWebSocket as unknown as typeof WebSocket,
  });
  await new Promise<void>((resolve) => {
    const onSync = (s: boolean) => {
      if (s) {
        provider.off("sync", onSync);
        resolve();
      }
    };
    provider.on("sync", onSync);
  });
  return { doc, provider };
}

async function main() {
  console.log(`Room: ${ROOM}\nServer: ${WS_URL}\n`);

  // --- 1. Offline persistence: edits survive a "reload" with zero network ---
  const docA = new Y.Doc();
  const idbA = new IndexeddbPersistence(ROOM, docA);
  await idbA.whenSynced;
  const a = createBoardActions(docA);
  a.addColumn("Offline col");
  await sleep(50);
  const colId = deriveBoardView(docA).columns[0].id;
  a.addCard(colId, "Offline card 1");
  a.addCard(colId, "Offline card 2");
  await sleep(400); // let y-indexeddb write its update batches
  const offlineView = deriveBoardView(docA);
  idbA.destroy(); // detaches from docA, KEEPS the stored data (clearData deletes)
  docA.destroy();

  const docB = new Y.Doc();
  const idbB = new IndexeddbPersistence(ROOM, docB);
  await idbB.whenSynced;
  const reloaded = deriveBoardView(docB);
  check(
    eq(reloaded, offlineView) && reloaded.columns[0]?.cards.length === 2,
    "offline edits survive a reload from IndexedDB (no network)",
  );

  // --- 2. Reconnect replay: offline edits reach the server + other clients ---
  const tokenB = await mintEditorToken(ROOM);
  const provB = new WebsocketProvider(WS_URL, ROOM, docB, {
    disableBc: true,
    params: tokenB ? { token: tokenB } : {},
    WebSocketPolyfill: WsWebSocket as unknown as typeof WebSocket,
  });
  await new Promise<void>((resolve) => {
    const onSync = (s: boolean) => {
      if (s) {
        provB.off("sync", onSync);
        resolve();
      }
    };
    provB.on("sync", onSync);
  });
  await sleep(300);

  const C = await connect(ROOM);
  await sleep(400);
  const viewC = deriveBoardView(C.doc);
  check(
    viewC.columns[0]?.cards.map((c) => c.title).join("|") ===
      "Offline card 1|Offline card 2",
    "offline edits replay to the server and reach a fresh online client",
  );

  // --- 3. Restore transplant: hard reset to an earlier snapshot -------------
  const snapshotT1 = Y.encodeStateAsUpdate(docB); // 1 col / 2 cards
  const b = createBoardActions(docB);
  b.addColumn("Post-snapshot col");
  b.addCard(colId, "Post-snapshot card");
  await sleep(400);
  check(
    deriveBoardView(C.doc).columns.length === 2,
    "post-snapshot edits synced (setup)",
  );

  replaceDocFromSnapshot(docB, snapshotT1);
  await sleep(500);
  const restoredB = deriveBoardView(docB);
  const restoredC = deriveBoardView(C.doc);
  check(eq(restoredB, restoredC), "restore converges across clients (B === C)");
  check(
    restoredB.columns.length === 1 &&
      restoredB.columns[0].cards.length === 2 &&
      restoredB.columns[0].title === "Offline col",
    "restored view matches the snapshot (1 col, 2 cards)",
  );

  // --- 4. REGRESSION: restore vs concurrent offline edits -------------------
  // An offline peer adds a card and edits a title while another client
  // restores. The in-place rebuild must keep the offline ADD visible after
  // reconnect (a naive replace-the-Y.Maps restore tombstones the old subtrees
  // and the offline edits silently vanish — the Phase 5 review's HIGH finding).
  const snapshotT2 = Y.encodeStateAsUpdate(docB);
  C.provider.disconnect(); // C goes "offline"
  const cActions = createBoardActions(C.doc);
  cActions.addCard(colId, "Added while offline");
  const targetCard = deriveBoardView(C.doc).columns[0].cards[0];
  cActions.updateCard(targetCard.id, { title: "Edited while offline" });

  replaceDocFromSnapshot(docB, snapshotT2); // B restores while C is offline
  await sleep(300);
  C.provider.connect(); // C comes back; offline edits merge
  await sleep(900);

  const mergedB = deriveBoardView(docB);
  const mergedC = deriveBoardView(C.doc);
  check(eq(mergedB, mergedC), "restore vs offline edits converge (B === C)");
  const allTitles = mergedB.columns.flatMap((c) => c.cards.map((x) => x.title));
  check(
    allTitles.includes("Added while offline"),
    "card added offline during a restore SURVIVES and is visible",
  );
  check(
    allTitles.filter((t) => t === "Added while offline").length === 1,
    "offline-added card appears exactly once",
  );

  provB.destroy();
  idbB.destroy();
  docB.destroy();
  C.provider.destroy();
  C.doc.destroy();

  console.log(failed ? "\nRESULT: FAIL" : "\nRESULT: PASS — offline + restore checks passed");
  await sleep(100);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
