"use client";

/**
 * PageRoomProvider (N2) — owns the Yjs doc + IndexedDB cache + y-websocket
 * provider + awareness for one page room (`page:<id>`), exposed through
 * context. The full-page TipTap editor binds to the doc's default
 * Y.XmlFragment; there are no board stores (a page is a single document).
 *
 * Offline-first + token-refresh mirror BoardRoomProvider (the essentials are
 * duplicated deliberately — generalizing the two providers is a bigger refactor
 * than N2 warrants; revisit if a third room type appears).
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
import type { ConnectionStatus } from "@collabcanvas/shared";
import { WS_URL } from "../board/config";
import { colorForUserId, getLocalUser, type LocalUser } from "../board/localUser";

export interface PageRoom {
  pageId: string;
  doc: Y.Doc;
  awareness: Awareness;
  localUser: LocalUser;
  status: ConnectionStatus;
  canEdit: boolean;
}

const PageRoomContext = createContext<PageRoom | null>(null);

export function usePageRoom(): PageRoom {
  const room = useContext(PageRoomContext);
  if (!room) throw new Error("usePageRoom must be used inside <PageRoomProvider>");
  return room;
}

class WsTokenError extends Error {
  constructor(readonly status: number) {
    super(`ws-token: HTTP ${status}`);
  }
}

async function fetchPageToken(pageId: string): Promise<string> {
  const res = await fetch(`/api/pages/${pageId}/ws-token`);
  if (!res.ok) throw new WsTokenError(res.status);
  const body = (await res.json()) as { token: string };
  return body.token;
}

const roomForPage = (pageId: string): string => `page:${pageId}`;

interface Props {
  pageId: string;
  canEdit?: boolean;
  user?: { id: string; name: string; image?: string };
  children: ReactNode;
}

export function PageRoomProvider({ pageId, canEdit = true, user, children }: Props) {
  const [handle, setHandle] = useState<{
    doc: Y.Doc;
    awareness: Awareness;
    localUser: LocalUser;
  } | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [failed, setFailed] = useState(false);

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

    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    const idb = new IndexeddbPersistence(roomForPage(pageId), doc);
    const localUser = presenceUser ?? getLocalUser();
    // Publish identity so CollaborationCaret peers resolve immediately.
    awareness.setLocalStateField("user", localUser);

    let lastTokenRefresh = 0;
    const refreshToken = () => {
      if (!provider || !navigator.onLine) return;
      const now = Date.now();
      if (now - lastTokenRefresh < 10_000) return;
      lastTokenRefresh = now;
      fetchPageToken(pageId)
        .then((fresh) => {
          if (provider) provider.params = { token: fresh };
        })
        .catch(() => {
          lastTokenRefresh = 0;
        });
    };

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

    const onOffline = () => setStatus("offline");
    const onOnline = () => {
      setStatus(provider?.wsconnected ? "connected" : inOutage ? "disconnected" : "connecting");
      refreshToken();
    };
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStatus(navigator.onLine ? "connecting" : "offline");
    setHandle({ doc, awareness, localUser });

    void (async () => {
      while (!cancelled) {
        try {
          const token = await fetchPageToken(pageId);
          if (cancelled) return;
          provider = new WebsocketProvider(WS_URL, roomForPage(pageId), doc, {
            params: { token },
            awareness,
          });
          lastTokenRefresh = Date.now();
          provider.on("status", onStatus);
          provider.on("connection-error", refreshToken);
          provider.on("connection-close", refreshToken);
          return;
        } catch (err) {
          if (cancelled) return;
          if (err instanceof WsTokenError && (err.status === 401 || err.status === 403)) {
            setFailed(true);
            return;
          }
          await new Promise((r) => setTimeout(r, 5000));
        }
      }
    })();

    return () => {
      cancelled = true;
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
      provider?.destroy();
      void idb.destroy();
      doc.destroy();
      setHandle(null);
      setStatus("connecting");
      setFailed(false);
    };
  }, [pageId, presenceUser]);

  const value = useMemo<PageRoom | null>(() => {
    if (!handle) return null;
    return {
      pageId,
      doc: handle.doc,
      awareness: handle.awareness,
      localUser: handle.localUser,
      status,
      canEdit,
    };
  }, [handle, status, pageId, canEdit]);

  if (failed) {
    return (
      <div className="cc-dots flex min-h-dvh flex-col items-center justify-center gap-3">
        <div className="font-display text-base font-semibold text-[var(--ink)]">
          Couldn&apos;t connect to this page
        </div>
        <div className="font-sans text-[12.5px] text-[var(--ink-soft)]">
          Your session may have expired — try reloading the page.
        </div>
      </div>
    );
  }

  if (!value) return null;

  return <PageRoomContext.Provider value={value}>{children}</PageRoomContext.Provider>;
}
