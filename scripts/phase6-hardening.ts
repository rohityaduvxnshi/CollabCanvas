/**
 * Phase 6 headless harness. Spawns its OWN ws-server child on :4100 (with the
 * guarded test-shutdown endpoint enabled), so the dev server on :4000 is
 * untouched. Verifies the Phase 6 acceptance criteria:
 *
 *   1. Token expiry: a live connection outlives its token (v1 behavior), an
 *      expired token is 401-rejected at the next (re)connect, and updating
 *      `provider.params` with a fresh token makes the SAME provider reconnect
 *      and sync — the exact mechanism the web app's refresh listeners rely on.
 *   2. Oversized payloads (>1MB) get the connection closed; server stays up.
 *   3. Graceful shutdown flushes un-debounced edits to Postgres before exit.
 *
 * Run:  npx tsx scripts/phase6-hardening.ts   (needs DATABASE_URL in ws-server/.env)
 */

import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import process from "node:process";
import * as Y from "yjs";
import { WebSocket as WsWebSocket } from "ws";
import { WebsocketProvider } from "y-websocket";
import { createBoardActions } from "../web/lib/yjs/mutations";
import { deriveBoardView } from "../web/lib/yjs/deriveBoardView";
import { mintEditorToken } from "./mintToken";

const PORT = 4100;
const WS_URL = `ws://localhost:${PORT}`;
const ROOM = `board:phase6-${Date.now()}`;
const BARE = ROOM.slice("board:".length);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let failed = false;
function check(cond: boolean, msg: string) {
  if (cond) console.log("  ✅", msg);
  else {
    console.error("  ❌ FAIL:", msg);
    failed = true;
  }
}

const repoRoot = path.resolve(__dirname, "..");

function startServer(): ChildProcess {
  return spawn(
    process.execPath,
    [path.join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs"), "src/index.ts"],
    {
      cwd: path.join(repoRoot, "ws-server"),
      env: { ...process.env, PORT: String(PORT), WS_ENABLE_TEST_SHUTDOWN: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
}

async function waitHealthy(timeoutMs = 15000): Promise<boolean> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const res = await fetch(`http://localhost:${PORT}/health`);
      if (res.ok) return true;
    } catch {
      // not up yet
    }
    await sleep(300);
  }
  return false;
}

function makeProvider(doc: Y.Doc, token: string) {
  return new WebsocketProvider(WS_URL, ROOM, doc, {
    disableBc: true,
    params: { token },
    WebSocketPolyfill: WsWebSocket as unknown as typeof WebSocket,
  });
}

function waitSynced(provider: WebsocketProvider, timeoutMs: number): Promise<boolean> {
  if (provider.synced) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      provider.off("sync", onSync);
      resolve(false);
    }, timeoutMs);
    const onSync = (s: boolean) => {
      if (s) {
        clearTimeout(timer);
        provider.off("sync", onSync);
        resolve(true);
      }
    };
    provider.on("sync", onSync);
  });
}

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
    create: { id: boardId, title: "Phase6 board", ownerId: user.id },
    update: {},
  });
}

async function main() {
  console.log(`Room: ${ROOM}\nChild server: ${WS_URL}\n`);
  await ensureBoardRow(BARE);

  let child = startServer();
  check(await waitHealthy(), "child ws-server came up on :4100");

  // --- 1. Token expiry ------------------------------------------------------
  const shortToken = await mintEditorToken(ROOM, "1s");
  if (!shortToken) {
    console.error("WS_JWT_SECRET not set — cannot run Phase 6 harness");
    process.exit(2);
  }
  const doc = new Y.Doc();
  const provider = makeProvider(doc, shortToken);
  check(await waitSynced(provider, 5000), "connects + syncs with a valid short-lived token");

  await sleep(1600); // token now expired
  check(
    provider.wsconnected,
    "live connection outlives its token (expiry checked at handshake only — v1 behavior)",
  );

  provider.disconnect();
  await sleep(200);
  provider.connect();
  const reconnectedStale = await waitSynced(provider, 3000);
  check(!reconnectedStale, "reconnect with the EXPIRED token is rejected (401 at upgrade)");

  const freshToken = await mintEditorToken(ROOM, "10m");
  provider.params = { token: freshToken! }; // what the app's refresh listeners do
  const reconnectedFresh = await waitSynced(provider, 8000);
  check(reconnectedFresh, "updating provider.params with a fresh token reconnects + syncs");

  // --- 2. Oversized message -------------------------------------------------
  const raw = new WsWebSocket(`${WS_URL}/${ROOM}?token=${freshToken}`);
  const closed = await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), 4000);
    raw.on("open", () => raw.send(Buffer.alloc(1_500_000)));
    raw.on("close", () => {
      clearTimeout(timer);
      resolve(true);
    });
    raw.on("error", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
  check(closed, "oversized (1.5MB) message gets the connection closed");
  const health = await fetch(`http://localhost:${PORT}/health`);
  check(health.ok, "server stays healthy after the oversized message");

  // --- 3. Graceful shutdown flushes snapshots -------------------------------
  const actions = createBoardActions(doc);
  actions.addColumn("Flush me");
  await sleep(150);
  const colId = deriveBoardView(doc).columns.find((c) => c.title === "Flush me")!.id;
  actions.addCard(colId, "Written moments before shutdown");
  await sleep(400); // well under the 3s debounce — only the shutdown flush saves this

  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  await fetch(`http://localhost:${PORT}/__shutdown`, { method: "POST" });
  await Promise.race([exited, sleep(8000)]);
  check(child.exitCode !== null, "server exits after the shutdown request");
  provider.destroy();
  doc.destroy();

  child = startServer();
  check(await waitHealthy(), "restarted child came up");
  const doc2 = new Y.Doc();
  const provider2 = makeProvider(doc2, (await mintEditorToken(ROOM, "10m"))!);
  await waitSynced(provider2, 5000);
  await sleep(1000); // async snapshot load
  const titles = deriveBoardView(doc2).columns.flatMap((c) => c.cards.map((x) => x.title));
  check(
    titles.includes("Written moments before shutdown"),
    "un-debounced edit survived via the shutdown flush (restored from Postgres)",
  );

  provider2.destroy();
  doc2.destroy();
  child.kill();
  await sleep(300);

  console.log(failed ? "\nRESULT: FAIL" : "\nRESULT: PASS — hardening checks passed");
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
