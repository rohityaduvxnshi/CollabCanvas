import type * as Y from "yjs";
import type { BoardData } from "@collabcanvas/shared";
import { deriveBoardView } from "../yjs/deriveBoardView";

/**
 * A `useSyncExternalStore`-compatible store over a Yjs doc. It caches the
 * derived `BoardData` and recomputes it only when the doc changes, so
 * `getSnapshot` returns a referentially-stable value between renders.
 *
 * Owned by `BoardRoomProvider` (alongside the doc + provider) and handed to the
 * UI through context — so `useBoard` never touches a ref during render.
 */
export class BoardStore {
  readonly doc: Y.Doc;
  private snapshot: BoardData;
  private readonly listeners = new Set<() => void>();

  constructor(doc: Y.Doc) {
    this.doc = doc;
    this.snapshot = deriveBoardView(doc);
    this.subscribe = this.subscribe.bind(this);
    this.getSnapshot = this.getSnapshot.bind(this);
    this.handleUpdate = this.handleUpdate.bind(this);
  }

  private handleUpdate() {
    this.snapshot = deriveBoardView(this.doc);
    for (const listener of this.listeners) listener();
  }

  subscribe(onStoreChange: () => void): () => void {
    if (this.listeners.size === 0) this.doc.on("update", this.handleUpdate);
    this.listeners.add(onStoreChange);
    // The doc may have advanced between construction and this subscription — the
    // server's initial state can be applied, or the board seeded, before the
    // listener was attached. Refresh so useSyncExternalStore's post-subscribe
    // check observes the latest view instead of a stale (possibly empty) one.
    this.snapshot = deriveBoardView(this.doc);
    return () => {
      this.listeners.delete(onStoreChange);
      if (this.listeners.size === 0) this.doc.off("update", this.handleUpdate);
    };
  }

  getSnapshot(): BoardData {
    return this.snapshot;
  }
}
