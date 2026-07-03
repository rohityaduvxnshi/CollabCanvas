/**
 * PresenceStore — the sync-layer half of `usePresence()` (spec §7).
 *
 * Wraps a y-protocols `Awareness` instance:
 *  - publishes the local state `{ user, cursor, editingCardId }`,
 *  - exposes remote peers as a cached, `useSyncExternalStore`-compatible
 *    snapshot (recomputed only on awareness `change` events),
 *  - throttles cursor writes to ~20/s internally (leading + trailing edge), so
 *    the UI may call `setCursor` on every pointermove without flooding the
 *    socket — cursor movement is the highest-frequency message in the app.
 *
 * Framework-agnostic (no React imports): owned by BoardRoomProvider, consumed
 * by the `usePresence` hook, testable headlessly.
 */

import type { Awareness } from "y-protocols/awareness";
import type { AwarenessState, PeerPresence } from "@collabcanvas/shared";
import type { LocalUser } from "./localUser";

/** ~20 updates/sec. */
const CURSOR_THROTTLE_MS = 50;

export class PresenceStore {
  private readonly awareness: Awareness;
  private peers: PeerPresence[];
  private readonly listeners = new Set<() => void>();
  /** Cursor value awaiting the next throttle window; `undefined` = none. */
  private pendingCursor: { x: number; y: number } | null | undefined;
  private throttleTimer: ReturnType<typeof setTimeout> | null = null;
  private lastFlushAt = 0;
  private destroyed = false;

  constructor(awareness: Awareness, user: LocalUser) {
    this.awareness = awareness;
    const initial: AwarenessState = { user, cursor: null, editingCardId: null };
    awareness.setLocalState(initial);
    this.peers = this.computePeers();
    this.subscribe = this.subscribe.bind(this);
    this.getSnapshot = this.getSnapshot.bind(this);
    this.handleChange = this.handleChange.bind(this);
  }

  private computePeers(): PeerPresence[] {
    const out: PeerPresence[] = [];
    for (const [clientId, raw] of this.awareness.getStates()) {
      if (clientId === this.awareness.clientID) continue;
      const state = raw as Partial<AwarenessState>;
      if (!state.user) continue; // peer hasn't published a full state yet
      out.push({
        clientId,
        userId: state.user.id,
        name: state.user.name,
        color: state.user.color,
        image: state.user.image,
        cursor: state.cursor ?? null,
        editingCardId: state.editingCardId ?? null,
      });
    }
    return out;
  }

  private handleChange(change: {
    added: number[];
    updated: number[];
    removed: number[];
  }) {
    // Our own state changes (every throttled cursor flush!) can never alter the
    // PEERS snapshot — self is filtered out of computePeers. Skipping them keeps
    // the snapshot reference stable, so solo mouse movement doesn't re-render
    // the whole board ~20x/sec through useSyncExternalStore.
    const changed = [...change.added, ...change.updated, ...change.removed];
    if (
      changed.length > 0 &&
      changed.every((id) => id === this.awareness.clientID)
    ) {
      return;
    }
    this.peers = this.computePeers();
    for (const listener of this.listeners) listener();
  }

  subscribe(onStoreChange: () => void): () => void {
    // `change` (not `update`): fires only when a state actually changed, not on
    // every awareness heartbeat message (verified in y-protocols/awareness.js).
    if (this.listeners.size === 0) this.awareness.on("change", this.handleChange);
    this.listeners.add(onStoreChange);
    // Peers may have changed between construction and first subscription —
    // refresh so the initial render isn't stale (same fix as BoardStore).
    this.peers = this.computePeers();
    return () => {
      this.listeners.delete(onStoreChange);
      if (this.listeners.size === 0)
        this.awareness.off("change", this.handleChange);
    };
  }

  getSnapshot(): PeerPresence[] {
    return this.peers;
  }

  // --- local-state mutators -------------------------------------------------

  private flushPendingCursor() {
    if (this.pendingCursor === undefined || this.destroyed) return;
    const cursor = this.pendingCursor;
    this.pendingCursor = undefined;
    this.lastFlushAt = Date.now();
    this.awareness.setLocalStateField("cursor", cursor);
  }

  /** Report the local cursor (board-content coordinates). Safe to call on every
   *  pointermove — writes are throttled to ~20/s (leading + trailing edge). */
  setCursor(x: number, y: number): void {
    this.pendingCursor = { x, y };
    this.scheduleFlush();
  }

  /** Hide the local cursor (pointer left the board). */
  clearCursor(): void {
    this.pendingCursor = null;
    this.scheduleFlush();
  }

  /**
   * Time-based throttle: at most ONE write per CURSOR_THROTTLE_MS, sustained.
   * If the window since the last write has elapsed, flush immediately (leading
   * edge — the first move after idle shows instantly); otherwise schedule a
   * trailing flush for when the window closes, so the last position always
   * lands. (A naive leading+trailing pair per window would double the rate to
   * ~40/s under continuous movement.)
   */
  private scheduleFlush() {
    if (this.throttleTimer !== null) return; // trailing flush already scheduled
    const elapsed = Date.now() - this.lastFlushAt;
    if (elapsed >= CURSOR_THROTTLE_MS) {
      this.flushPendingCursor();
      return;
    }
    this.throttleTimer = setTimeout(() => {
      this.throttleTimer = null;
      this.flushPendingCursor();
    }, CURSOR_THROTTLE_MS - elapsed);
  }

  /** Mark which card the local user is editing (null = none). Low-frequency —
   *  written immediately, no throttle. */
  setEditing(cardId: string | null): void {
    if (this.destroyed) return;
    this.awareness.setLocalStateField("editingCardId", cardId);
  }

  /** Detach listeners/timers. The provider owns the Awareness lifecycle; the
   *  server broadcasts our departure when the socket closes. */
  destroy(): void {
    this.destroyed = true;
    if (this.throttleTimer !== null) {
      clearTimeout(this.throttleTimer);
      this.throttleTimer = null;
    }
    this.awareness.off("change", this.handleChange);
    this.listeners.clear();
  }
}
