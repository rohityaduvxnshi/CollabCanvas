import type * as Y from "yjs";
import type { DbView } from "@collabcanvas/shared";
import { deriveDbView } from "../yjs/deriveDbView";

/**
 * `useSyncExternalStore`-compatible store over a database Y.Doc (N4). Caches the
 * derived `DbView` and recomputes only on doc changes, so `getSnapshot` returns
 * a referentially-stable value between renders. Mirrors BoardStore.
 */
export class DbStore {
  readonly doc: Y.Doc;
  private snapshot: DbView;
  private readonly listeners = new Set<() => void>();

  constructor(doc: Y.Doc) {
    this.doc = doc;
    this.snapshot = deriveDbView(doc);
    this.subscribe = this.subscribe.bind(this);
    this.getSnapshot = this.getSnapshot.bind(this);
    this.handleUpdate = this.handleUpdate.bind(this);
  }

  private handleUpdate() {
    this.snapshot = deriveDbView(this.doc);
    for (const listener of this.listeners) listener();
  }

  subscribe(onStoreChange: () => void): () => void {
    if (this.listeners.size === 0) this.doc.on("update", this.handleUpdate);
    this.listeners.add(onStoreChange);
    this.snapshot = deriveDbView(this.doc); // refresh: doc may have advanced
    return () => {
      this.listeners.delete(onStoreChange);
      if (this.listeners.size === 0) this.doc.off("update", this.handleUpdate);
    };
  }

  getSnapshot(): DbView {
    return this.snapshot;
  }
}
