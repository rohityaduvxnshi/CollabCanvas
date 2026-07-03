/**
 * Phase 1 reconnect test — Node edition, using the `ws` package as the
 * WebSocket polyfill.
 *
 * Why not Node's built-in global WebSocket: undici's WebSocket does not reliably
 * emit a `close` event on a refused connection, and y-websocket's auto-reconnect
 * loop retries on `close`. So a headless test on the built-in WebSocket appears
 * to "stall" after one attempt — a Node/undici quirk, NOT a bug in the browser
 * app (browsers fire `close` on failure). The `ws` polyfill behaves like a
 * browser here, giving a faithful reconnect test.
 */

import * as Y from "yjs";
import { WebSocket as WsWebSocket } from "ws";
import { WebsocketProvider } from "y-websocket";
import { createBoardActions } from "../web/lib/yjs/mutations";
import { deriveBoardView } from "../web/lib/yjs/deriveBoardView";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:4000";
const ROOM = "board:phase1-reconnect2";

const doc = new Y.Doc();
const provider = new WebsocketProvider(WS_URL, ROOM, doc, {
  disableBc: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  WebSocketPolyfill: WsWebSocket as unknown as typeof WebSocket,
});
const actions = createBoardActions(doc);

const ts = () => new Date().toISOString().slice(11, 23);
let reconnectedAfterDrop = false;
let everDropped = false;

provider.on("status", (e: { status: string }) => {
  console.log(`${ts()} status: ${e.status}`);
  if (e.status === "disconnected") everDropped = true;
  if (e.status === "connected" && everDropped) reconnectedAfterDrop = true;
});
provider.on("sync", (synced: boolean) => {
  console.log(`${ts()} synced: ${synced}`);
  if (synced) {
    actions.addColumn(`col-${ts()}`);
    console.log(
      `${ts()} wrote OK; columns = ${deriveBoardView(doc).columns.length}`,
    );
  }
});
provider.on("connection-error", () => console.log(`${ts()} connection-error`));

console.log(`${ts()} watcher started (ws polyfill) -> ${WS_URL} room ${ROOM}`);
setTimeout(() => {
  console.log(
    `${ts()} watcher done | dropped=${everDropped} reconnected=${reconnectedAfterDrop}`,
  );
  process.exit(reconnectedAfterDrop ? 0 : 2);
}, 40000);
