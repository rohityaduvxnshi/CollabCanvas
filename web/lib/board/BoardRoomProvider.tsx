"use client";

/**
 * BoardRoomProvider — owns the Yjs doc + local persistence + y-websocket
 * provider + derived-view/presence stores for one board room, and exposes them
 * through React context. This is the ONLY component that creates Yjs objects.
 *
 * Offline-first (Phase 5): the doc, the y-indexeddb cache, and the stores are
 * created SYNCHRONOUSLY — the board renders instantly from the local cache,
 * even with no network. The WebSocket side attaches asynchronously once the
 * short-lived ws-token arrives; while offline the token fetch retries quietly
 * (401/403 = real auth failure = error screen; network errors = keep waiting).
 * Offline edits accumulate in IndexedDB and Yjs merges them on reconnect.
 *
 * Auth (spec §5): the token is passed as the `token` query param. On every
 * disconnect (and on browser 'online') it refreshes the token — y-websocket v3
 * re-reads `provider.params` per reconnect attempt (verified in the installed
 * source). The Awareness instance is created by us and handed to the provider
 * (`opts.awareness`, verified in v3 source) so presence exists before the
 * socket does.
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import { IndexeddbPersistence } from "y-indexeddb";
import { Awareness } from "y-protocols/awareness";
import { roomForBoard, type ConnectionStatus } from "@collabcanvas/shared";
import { WS_URL } from "./config";
import { BoardStore } from "./boardStore";
import { PresenceStore } from "./presenceStore";
import { colorForUserId, getLocalUser, type LocalUser } from "./localUser";
import { ensureBoardMeta } from "../yjs/seed";

export interface BoardRoom {
  boardId: string;
  doc: Y.Doc;
  store: BoardStore;
  presence: PresenceStore;
  status: ConnectionStatus;
  /** Whether the local user may mutate the board (false for viewers). */
  canEdit: boolean;
}

const BoardRoomContext = createContext<BoardRoom | null>(null);

export function useBoardRoom(): BoardRoom {
  const room = useContext(BoardRoomContext);
  if (!room) {
    throw new Error("useBoardRoom must be used inside <BoardRoomProvider>");
  }
  return room;
}

class WsTokenError extends Error {
  constructor(readonly status: number) {
    super(`ws-token: HTTP ${status}`);
  }
}

async function fetchWsToken(boardId: string): Promise<string> {
  const res = await fetch(`/api/rooms/${boardId}/ws-token`);
  if (!res.ok) throw new WsTokenError(res.status);
  const body = (await res.json()) as { token: string };
  return body.token;
}

interface BoardRoomProviderProps {
  boardId: string;
  /** Board title from the database — written into the doc's meta on first sync. */
  boardTitle?: string;
  /** From the session + membership check on the server. */
  canEdit?: boolean;
  /** Signed-in identity for presence; falls back to a per-tab guest. */
  user?: { id: string; name: string; image?: string };
  children: ReactNode;
}

export function BoardRoomProvider({
  boardId,
  boardTitle,
  canEdit = true,
  user,
  children,
}: BoardRoomProviderProps) {
  const [handle, setHandle] = useState<{
    doc: Y.Doc;
    store: BoardStore;
    presence: PresenceStore;
  } | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [failed, setFailed] = useState(false);

  // Presence identity: session user (stable color from id) or per-tab guest.
  const presenceUser = useMemo<LocalUser | null>(
    () =>
      user
        ? {
            id: user.id,
            name: user.name,
            color: colorForUserId(user.id),
            ...(user.image ? { image: user.image } : {}),
          }
        : null,
    [user],
  );

  useEffect(() => {
    let cancelled = false;
    let provider: WebsocketProvider | null = null;

    // --- Local-first: everything below works with zero network. -------------
    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    const idb = new IndexeddbPersistence(roomForBoard(boardId), doc);
    const store = new BoardStore(doc);
    const presence = new PresenceStore(awareness, presenceUser ?? getLocalUser());

    if (boardTitle) {
      void idb.whenSynced.then(() => {
        if (!cancelled) ensureBoardMeta(doc, boardTitle);
      });
    }

    // Refresh the 5-minute token so reconnect attempts use a fresh one. Wired
    // to 'connection-error'/'connection-close' (which fire on EVERY failed
    // attempt — a 401-rejected upgrade emits no 'disconnected' status, so a
    // one-shot refresh there could strand the provider on an expired token
    // forever) and throttled so backoff loops don't hammer the token route.
    let lastTokenRefresh = 0;
    const refreshToken = () => {
      if (!provider || !navigator.onLine) return;
      const now = Date.now();
      if (now - lastTokenRefresh < 10_000) return;
      lastTokenRefresh = now;
      fetchWsToken(boardId)
        .then((fresh) => {
          if (provider) provider.params = { token: fresh };
        })
        .catch(() => {
          // Throttle window keeps this retrying on subsequent attempts.
          lastTokenRefresh = 0;
        });
    };

    // Once a live connection drops, keep reporting "disconnected" through the
    // provider's connecting→failing backoff cycles (each retry emits
    // 'connecting'); flipping to "connecting" per tick would hide the outage
    // banner after ~100ms. "connecting" is shown only before the first sync.
    let inOutage = false;
    const onStatus = (event: { status: ConnectionStatus }) => {
      if (event.status === "connected") {
        inOutage = false;
        setStatus("connected");
        return;
      }
      if (event.status === "disconnected") inOutage = true;
      const effective: ConnectionStatus = inOutage ? "disconnected" : event.status;
      setStatus(!navigator.onLine ? "offline" : effective);
      if (event.status === "disconnected") refreshToken();
    };
    const onSync = (isSynced: boolean) => {
      if (isSynced && boardTitle) ensureBoardMeta(doc, boardTitle);
    };

    const onOffline = () => setStatus("offline");
    const onOnline = () => {
      setStatus(
        provider?.wsconnected ? "connected" : inOutage ? "disconnected" : "connecting",
      );
      refreshToken();
    };
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);

    // Publishing an effect-owned external system into state (StrictMode-safe,
    // see header) — the set-state-in-effect heuristic is a false positive here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStatus(navigator.onLine ? "connecting" : "offline");
    setHandle({ doc, store, presence });

    // --- Network side: attach the WS provider once a token arrives. ---------
    void (async () => {
      while (!cancelled) {
        try {
          const token = await fetchWsToken(boardId);
          if (cancelled) return;
          provider = new WebsocketProvider(WS_URL, roomForBoard(boardId), doc, {
            params: { token },
            awareness,
          });
          lastTokenRefresh = Date.now();
          provider.on("status", onStatus);
          provider.on("sync", onSync);
          // Fire on every failed attempt — the reliable token-refresh hook.
          provider.on("connection-error", refreshToken);
          provider.on("connection-close", refreshToken);
          return;
        } catch (err) {
          if (cancelled) return;
          if (err instanceof WsTokenError && (err.status === 401 || err.status === 403)) {
            setFailed(true); // real auth problem — not a connectivity blip
            return;
          }
          // Network failure (likely offline): the board keeps working from the
          // local cache; retry quietly.
          await new Promise((r) => setTimeout(r, 5000));
        }
      }
    })();

    return () => {
      cancelled = true;
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
      presence.destroy();
      provider?.destroy();
      void idb.destroy();
      doc.destroy();
      setHandle(null);
      setStatus("connecting");
      setFailed(false);
    };
  }, [boardId, boardTitle, presenceUser]);

  const value = useMemo<BoardRoom | null>(() => {
    if (!handle) return null;
    return {
      boardId,
      doc: handle.doc,
      store: handle.store,
      presence: handle.presence,
      status,
      canEdit,
    };
  }, [handle, status, boardId, canEdit]);

  if (failed) {
    return (
      <div className="cc-dots flex min-h-dvh flex-col items-center justify-center gap-3">
        <div className="font-display text-base font-semibold text-[var(--ink)]">
          Couldn&apos;t connect to this board
        </div>
        <div className="font-sans text-[12.5px] text-[var(--ink-soft)]">
          Your session may have expired — try reloading the page.
        </div>
      </div>
    );
  }

  if (!value) return null; // one render at most — handle is set synchronously

  return (
    <BoardRoomContext.Provider value={value}>
      {children}
    </BoardRoomContext.Provider>
  );
}
