"use client";

/**
 * DbRoomProvider (N4) — owns the Yjs doc + IndexedDB cache + y-websocket
 * provider + DbStore + actions for one database room (`db:<id>`), exposed
 * through context. Offline-first + token-refresh mirror the page/board
 * providers (deliberate duplication — a shared provider is a bigger refactor).
 *
 * No awareness/presence in v1 tables (cell edits sync live; text carets aren't
 * meaningful in a grid) — documented gap.
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import { IndexeddbPersistence } from "y-indexeddb";
import {
  roomForDatabase,
  type ConnectionStatus,
  type DbActions,
  type DbView,
} from "@collabcanvas/shared";
import { WS_URL } from "../board/config";
import { DbStore } from "./dbStore";
import { createDbActions } from "../yjs/dbMutations";
import { ensureDbSeed } from "../yjs/dbSeed";

export interface DbRoom {
  databaseId: string;
  doc: Y.Doc;
  store: DbStore;
  actions: DbActions;
  status: ConnectionStatus;
  canEdit: boolean;
}

const DbRoomContext = createContext<DbRoom | null>(null);

export function useDbRoom(): DbRoom {
  const room = useContext(DbRoomContext);
  if (!room) throw new Error("useDbRoom must be used inside <DbRoomProvider>");
  return room;
}

class WsTokenError extends Error {
  constructor(readonly status: number) {
    super(`ws-token: HTTP ${status}`);
  }
}

async function fetchDbToken(databaseId: string): Promise<string> {
  const res = await fetch(`/api/databases/${databaseId}/ws-token`);
  if (!res.ok) throw new WsTokenError(res.status);
  const body = (await res.json()) as { token: string };
  return body.token;
}

interface Props {
  databaseId: string;
  databaseTitle?: string;
  canEdit?: boolean;
  children: ReactNode;
}

export function DbRoomProvider({ databaseId, databaseTitle, canEdit = true, children }: Props) {
  const [handle, setHandle] = useState<{ doc: Y.Doc; store: DbStore; actions: DbActions } | null>(
    null,
  );
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let provider: WebsocketProvider | null = null;

    const doc = new Y.Doc();
    const idb = new IndexeddbPersistence(roomForDatabase(databaseId), doc);
    const store = new DbStore(doc);
    const actions = createDbActions(doc);

    if (databaseTitle) {
      void idb.whenSynced.then(() => {
        if (!cancelled) ensureDbSeed(doc, databaseTitle);
      });
    }

    let lastTokenRefresh = 0;
    const refreshToken = () => {
      if (!provider || !navigator.onLine) return;
      const now = Date.now();
      if (now - lastTokenRefresh < 10_000) return;
      lastTokenRefresh = now;
      fetchDbToken(databaseId)
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
    const onSync = (isSynced: boolean) => {
      if (isSynced && databaseTitle) ensureDbSeed(doc, databaseTitle);
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
    setHandle({ doc, store, actions });

    void (async () => {
      while (!cancelled) {
        try {
          const token = await fetchDbToken(databaseId);
          if (cancelled) return;
          provider = new WebsocketProvider(WS_URL, roomForDatabase(databaseId), doc, {
            params: { token },
          });
          lastTokenRefresh = Date.now();
          provider.on("status", onStatus);
          provider.on("sync", onSync);
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
  }, [databaseId, databaseTitle]);

  const value = useMemo<DbRoom | null>(() => {
    if (!handle) return null;
    return {
      databaseId,
      doc: handle.doc,
      store: handle.store,
      actions: handle.actions,
      status,
      canEdit,
    };
  }, [handle, status, databaseId, canEdit]);

  if (failed) {
    return (
      <div className="cc-dots flex min-h-dvh flex-col items-center justify-center gap-3">
        <div className="font-display text-base font-semibold text-[var(--ink)]">
          Couldn&apos;t connect to this database
        </div>
        <div className="font-sans text-[12.5px] text-[var(--ink-soft)]">
          Your session may have expired — try reloading the page.
        </div>
      </div>
    );
  }

  if (!value) return null;
  return <DbRoomContext.Provider value={value}>{children}</DbRoomContext.Provider>;
}

export function useDatabase(): {
  data: DbView;
  actions: DbActions;
  status: ConnectionStatus;
  canEdit: boolean;
} {
  const room = useDbRoom();
  const data = useSyncExternalStore(
    room.store.subscribe,
    room.store.getSnapshot,
    room.store.getSnapshot,
  );
  return { data, actions: room.actions, status: room.status, canEdit: room.canEdit };
}
