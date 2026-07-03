"use client";

/**
 * `usePresence()` — the presence half of the UI contract (spec §7).
 *
 * Returns the remote peers (cursor + editing state) and setters for the local
 * user's cursor / editing state. Components consume only this — no awareness,
 * no Yjs.
 *
 * Contract notes (see docs/claude-design-brief.md):
 *  - `setCursor` is throttled INTERNALLY to ~20/s; call it freely per pointermove.
 *  - `clearCursor` is an extension beyond the original spec signature, used to
 *    hide the cursor when the pointer leaves the board.
 */

import { useSyncExternalStore } from "react";
import type { PeerPresence } from "@collabcanvas/shared";
import { useBoardRoom } from "./BoardRoomProvider";

export interface UsePresenceResult {
  peers: PeerPresence[];
  setCursor(x: number, y: number): void;
  clearCursor(): void;
  setEditing(cardId: string | null): void;
}

// Stable server-side snapshot: must be the SAME reference on every call, or
// React would loop re-rendering during hydration.
const EMPTY_PEERS: PeerPresence[] = [];
const getServerPeers = (): PeerPresence[] => EMPTY_PEERS;

export function usePresence(): UsePresenceResult {
  const { presence } = useBoardRoom();

  const peers = useSyncExternalStore(
    presence.subscribe,
    presence.getSnapshot,
    // Server snapshot: no peers during SSR (presence is client-only anyway).
    getServerPeers,
  );

  return {
    peers,
    setCursor: (x, y) => presence.setCursor(x, y),
    clearCursor: () => presence.clearCursor(),
    setEditing: (cardId) => presence.setEditing(cardId),
  };
}
