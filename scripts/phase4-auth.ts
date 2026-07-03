/**
 * Phase 4 headless auth harness. Exercises the WS server's JWT gate and the
 * server-side viewer write-drop against a REAL board row (FK-valid snapshots).
 *
 * Mints tokens directly with the shared WS_JWT_SECRET (from ws-server/.env) —
 * the same claims the web app's /api/rooms/:boardId/ws-token route signs.
 *
 * Run (ws-server up, DB up):  npx tsx scripts/phase4-auth.ts
 */

import process from "node:process";
process.loadEnvFile("ws-server/.env");

import * as Y from "yjs";
import { SignJWT } from "jose";
import { WebSocket as WsWebSocket } from "ws";
import { WebsocketProvider } from "y-websocket";
import { getPrisma } from "@collabcanvas/db";
import { createBoardActions } from "../web/lib/yjs/mutations";
import { deriveBoardView } from "../web/lib/yjs/deriveBoardView";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:4000";
const SECRET = process.env.WS_JWT_SECRET;
if (!SECRET) {
  console.error("WS_JWT_SECRET missing from ws-server/.env");
  process.exit(2);
}
const key = new TextEncoder().encode(SECRET);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failed = false;
function check(cond: boolean, msg: string) {
  if (cond) console.log("  ✅", msg);
  else {
    console.error("  ❌ FAIL:", msg);
    failed = true;
  }
}

async function mint(
  claims: { room: string; role: string; sub: string; name?: string },
  expiresIn = "5m",
): Promise<string> {
  return new SignJWT({ room: claims.room, role: claims.role, name: claims.name ?? "Test" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(key);
}

function connect(room: string, token: string | null) {
  const doc = new Y.Doc();
  const provider = new WebsocketProvider(WS_URL, `board:${room}`, doc, {
    disableBc: true,
    WebSocketPolyfill: WsWebSocket as unknown as typeof WebSocket,
    ...(token ? { params: { token } } : {}),
  });
  return { doc, provider };
}

/** True if the provider reaches `synced` within `ms`. */
function syncsWithin(provider: WebsocketProvider, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    if (provider.synced) return resolve(true);
    const timer = setTimeout(() => {
      provider.off("sync", onSync);
      resolve(false);
    }, ms);
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

async function main() {
  const prisma = getPrisma();

  // --- fixture: a real user + board (FK-valid persistence) ---
  const user = await prisma.user.upsert({
    where: { email: "phase4-test@collabcanvas.local" },
    create: { email: "phase4-test@collabcanvas.local", name: "Phase4 Tester" },
    update: {},
  });
  const board = await prisma.board.create({
    data: {
      title: "Phase 4 Test Board",
      ownerId: user.id,
      members: { create: { userId: user.id, role: "editor" } },
    },
  });
  const roomId = board.id;
  console.log(`Fixture board: ${roomId}\n`);

  try {
    // --- 1. rejects: no token / garbage / wrong room / expired ---
    for (const [label, token] of [
      ["no token", null],
      ["garbage token", "not-a-jwt"],
      ["wrong-room token", await mint({ room: "someone-elses-board", role: "editor", sub: user.id })],
      ["expired token", await mint({ room: roomId, role: "editor", sub: user.id }, "-1m")],
    ] as const) {
      const c = connect(roomId, token);
      const synced = await syncsWithin(c.provider, 1500);
      check(!synced, `${label} → connection rejected`);
      c.provider.destroy();
      c.doc.destroy();
    }

    // --- 2. editor can write; second editor sees it ---
    const edA = connect(roomId, await mint({ room: roomId, role: "editor", sub: user.id }));
    const edB = connect(roomId, await mint({ room: roomId, role: "editor", sub: user.id }));
    check(await syncsWithin(edA.provider, 3000), "editor A connects + syncs");
    check(await syncsWithin(edB.provider, 3000), "editor B connects + syncs");

    const actionsA = createBoardActions(edA.doc);
    actionsA.addColumn("From editor");
    await sleep(500);
    check(
      deriveBoardView(edB.doc).columns.some((c) => c.title === "From editor"),
      "editor A's write reaches editor B",
    );

    // --- 3. viewer: receives state but writes are DROPPED server-side ---
    const vw = connect(roomId, await mint({ room: roomId, role: "viewer", sub: "viewer-1" }));
    check(await syncsWithin(vw.provider, 3000), "viewer connects + syncs");
    await sleep(300);
    check(
      deriveBoardView(vw.doc).columns.some((c) => c.title === "From editor"),
      "viewer received the board state",
    );

    const viewerActions = createBoardActions(vw.doc); // tampered client simulation
    viewerActions.addColumn("Viewer hack");
    await sleep(700);
    check(
      deriveBoardView(vw.doc).columns.some((c) => c.title === "Viewer hack"),
      "(sanity) tampered viewer applied its write locally",
    );
    check(
      !deriveBoardView(edB.doc).columns.some((c) => c.title === "Viewer hack"),
      "viewer's write NEVER reaches other clients (dropped server-side)",
    );

    // --- 4. viewer awareness (presence) still works ---
    vw.provider.awareness.setLocalState({
      user: { id: "viewer-1", name: "Viewer", color: "#ffb3c1" },
      cursor: { x: 5, y: 5 },
      editingCardId: null,
    });
    await sleep(500);
    const seen = Array.from(edB.provider.awareness.getStates().values()).some(
      (s) => (s as { user?: { id?: string } }).user?.id === "viewer-1",
    );
    check(seen, "viewer presence (awareness) still reaches editors");

    for (const c of [edA, edB, vw]) {
      c.provider.destroy();
      c.doc.destroy();
    }
  } finally {
    await prisma.board.delete({ where: { id: board.id } }).catch(() => {});
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    await prisma.$disconnect();
  }

  console.log(failed ? "\nRESULT: FAIL" : "\nRESULT: PASS — all auth checks passed");
  await sleep(100);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
