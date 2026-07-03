/**
 * Phase 2 headless presence harness.
 *
 * Two independent clients (ws polyfill, BroadcastChannel disabled → all traffic
 * through the real WS server) each running a PresenceStore. Verifies the Phase 2
 * acceptance criteria that don't need eyeballs:
 *   - peers see each other's identity (name/color)
 *   - cursor + editingCardId propagate
 *   - cursor writes are throttled (~20/s) but the LAST position always lands
 *   - clearCursor hides the cursor
 *   - closing a client removes its presence for peers within a few seconds
 *
 * Run (with the ws-server up):  npx tsx scripts/phase2-presence.ts
 */

import * as Y from "yjs";
import { WebSocket as WsWebSocket } from "ws";
import { WebsocketProvider } from "y-websocket";
import { PresenceStore } from "../web/lib/board/presenceStore";
import { mintEditorToken } from "./mintToken";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:4000";
const ROOM = `board:phase2-test-${Date.now()}`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let failed = false;
function check(cond: boolean, msg: string) {
  if (cond) console.log("  ✅", msg);
  else {
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

async function main() {
  console.log(`Room: ${ROOM}\nServer: ${WS_URL}\n`);
  const token = await mintEditorToken(ROOM);
  const A = connect(ROOM, token);
  const B = connect(ROOM, token);
  await Promise.all([waitSynced(A.provider), waitSynced(B.provider)]);

  const psA = new PresenceStore(A.provider.awareness, {
    id: "user-a",
    name: "Alice A",
    color: "#ef4444",
  });
  const psB = new PresenceStore(B.provider.awareness, {
    id: "user-b",
    name: "Bob B",
    color: "#3b82f6",
  });
  // Persistent subscriptions, mirroring useSyncExternalStore in the app (the
  // store recomputes its snapshot only while subscribed — by design).
  psA.subscribe(() => {});
  let counting = false;
  let notifications = 0;
  psB.subscribe(() => {
    if (counting) notifications++;
  });
  const peerA = () => psB.getSnapshot().find((p) => p.userId === "user-a");

  await sleep(600);

  // --- 1. identity propagation ---
  check(
    peerA()?.name === "Alice A" && peerA()?.color === "#ef4444",
    "B sees peer A's identity (name + color)",
  );
  check(
    psA.getSnapshot().some((p) => p.userId === "user-b" && p.name === "Bob B"),
    "A sees peer B's identity",
  );

  // --- 2. cursor + editing propagate ---
  psA.setCursor(123, 456);
  psA.setEditing("card-42");
  await sleep(400);
  check(
    peerA()?.cursor?.x === 123 && peerA()?.cursor?.y === 456,
    "cursor position propagates A -> B",
  );
  check(peerA()?.editingCardId === "card-42", "editingCardId propagates A -> B");

  // --- 3. throttle: rapid moves must reach B at ≤ ~1 update per 50ms window ---
  counting = true;
  const burstStart = Date.now();
  for (let i = 0; i < 100; i++) {
    psA.setCursor(i, i * 2);
    await sleep(3); // intent ~3ms; Node timers often round up to ~15ms
  }
  const burstMs = Date.now() - burstStart;
  await sleep(400); // allow trailing flush + delivery
  counting = false;
  // Sustained cap is 1 write / 50ms; bound by the MEASURED burst duration + slack.
  const maxAllowed = Math.ceil(burstMs / 50) + 3;
  check(
    notifications > 0 && notifications <= maxAllowed,
    `cursor updates throttled (${notifications} deliveries for 100 calls over ${burstMs}ms; cap ${maxAllowed})`,
  );
  check(
    peerA()?.cursor?.x === 99 && peerA()?.cursor?.y === 198,
    "final cursor position lands (trailing edge)",
  );

  // --- 4. clearCursor hides the cursor, identity remains ---
  psA.clearCursor();
  await sleep(300);
  check(peerA()?.cursor === null, "clearCursor hides the cursor");
  check(peerA()?.name === "Alice A", "peer identity remains after clearCursor");

  // --- 5. disconnect removes presence within a few seconds ---
  psA.destroy();
  A.provider.destroy();
  A.doc.destroy();
  await sleep(2000);
  check(
    psB.getSnapshot().every((p) => p.userId !== "user-a"),
    "closing A removes its presence for B within ~2s",
  );

  psB.destroy();
  B.provider.destroy();
  B.doc.destroy();

  console.log(failed ? "\nRESULT: FAIL" : "\nRESULT: PASS — all presence checks passed");
  await sleep(100);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
