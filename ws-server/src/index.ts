/**
 * CollabCanvas WebSocket server (standalone Node process; VPS via WinSW).
 *
 *  - `GET /health` → 200 + { rooms, uptime } (keep-alive / deploy health check).
 *  - WebSocket upgrades → JWT verified BEFORE the handshake, then Yjs sync +
 *    awareness per room (see ./yjs-sync).
 *  - Postgres snapshot persistence per room (see ./persistence).
 *  - Graceful shutdown (Phase 6): SIGINT/SIGTERM/SIGBREAK stop the listener,
 *    flush EVERY live room's snapshot, then exit. Windows services rarely get
 *    POSIX signals, so when WS_ENABLE_TEST_SHUTDOWN=1 a POST /__shutdown runs
 *    the same path — used by the harness and usable by WinSW pre-stop.
 *
 * The room name is the URL path (minus the leading slash and query string),
 * e.g. `wss://host/board:<id>?token=...` → room `board:<id>`.
 */

import "./env"; // MUST be first — later imports read process.env at module init
import http from "node:http";
import process from "node:process";
import { WebSocketServer, type WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import {
  setupWSConnection,
  flushAllRooms,
  liveRoomCount,
  markShuttingDown,
} from "./yjs-sync";
import { awaitInFlightWrites, persistenceEnabled } from "./persistence";
import { authEnabled, verifyWsToken, type ConnAuth } from "./auth";
import { log } from "./log";

const PORT = Number(process.env.PORT ?? 4000);
const startedAt = Date.now();

log.info(
  persistenceEnabled
    ? "persistence: Postgres snapshots enabled"
    : "persistence: DISABLED (no DATABASE_URL) — rooms are memory-only",
);
log.info(
  authEnabled
    ? "auth: JWT verification enabled"
    : "auth: DISABLED (no WS_JWT_SECRET) — open dev mode, anyone can edit",
);

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        status: "ok",
        service: "collabcanvas-ws",
        rooms: liveRoomCount(),
        uptimeSec: Math.round((Date.now() - startedAt) / 1000),
      }),
    );
    return;
  }
  if (
    req.method === "POST" &&
    req.url === "/__shutdown" &&
    process.env.WS_ENABLE_TEST_SHUTDOWN === "1"
  ) {
    res.writeHead(202, { "content-type": "text/plain" });
    res.end("shutting down");
    void shutdown("test-endpoint");
    return;
  }
  res.writeHead(404, { "content-type": "text/plain" });
  res.end("Not found");
});

// maxPayload makes `ws` itself refuse oversized frames (close 1009) BEFORE
// buffering them — without it ws would happily assemble 100MiB (its default)
// per message and the app-level size check would bound nothing.
const wss = new WebSocketServer({ noServer: true, maxPayload: 1_000_000 });

wss.on(
  "connection",
  (conn: WebSocket, _req: IncomingMessage, room: string, connAuth: ConnAuth) => {
    setupWSConnection(conn, room, { readOnly: connAuth.role === "viewer" });
  },
);

server.on("upgrade", (req, socket, head) => {
  // The http server stops owning the socket once 'upgrade' fires — without an
  // error listener, a TCP reset during the async token check below becomes an
  // uncaughtException that kills the whole process (confirmed DoS, no token
  // needed). Same guard the ws README's authentication example uses.
  const onSocketError = (err: Error) => {
    log.warn("upgrade socket error", { err: String(err) });
    socket.destroy();
  };
  socket.on("error", onSocketError);

  void (async () => {
    if (shuttingDown) {
      socket.write("HTTP/1.1 503 Service Unavailable\r\n\r\n");
      socket.destroy();
      return;
    }
    const url = new URL(req.url ?? "/", "http://localhost");
    const room = url.pathname.slice(1);
    const token = url.searchParams.get("token");

    const connAuth = await verifyWsToken(token, room);
    if (!connAuth) {
      try {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      } catch {
        // socket already gone
      }
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      socket.removeListener("error", onSocketError); // ws owns the socket now
      wss.emit("connection", ws, req, room, connAuth);
    });
  })().catch((err) => {
    log.error("upgrade handling failed", { err: String(err) });
    socket.destroy();
  });
});

// --- Graceful shutdown -------------------------------------------------------

let shuttingDown = false;

async function shutdown(reason: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  markShuttingDown(); // closeConn stops flushing/evicting — we own the flush now
  log.info("shutdown: closing clients, then flushing", {
    reason,
    rooms: liveRoomCount(),
  });
  // Order matters: stop new upgrades + close clients FIRST, so no update can
  // arrive during/after the flush and die with the process; then flush every
  // room; then await stray writes kicked off by the closes themselves.
  server.close();
  for (const client of wss.clients) {
    try {
      client.close(1001, "server shutting down");
    } catch {
      // already gone
    }
  }
  try {
    const { flushed, failed } = await flushAllRooms();
    await awaitInFlightWrites();
    if (failed > 0) log.error("shutdown: flush INCOMPLETE", { flushed, failed });
    else log.info("shutdown: flush complete", { flushed });
  } catch (err) {
    log.error("shutdown: flush failed", { err: String(err) });
  }
  process.exit(0);
}

// SIGBREAK = Ctrl+Break, the signal Windows consoles/WinSW can actually deliver.
for (const sig of ["SIGINT", "SIGTERM", "SIGBREAK"] as const) {
  process.on(sig, () => void shutdown(sig));
}

server.listen(PORT, () => {
  log.info("ws-server up", { port: PORT, health: "/health" });
});
