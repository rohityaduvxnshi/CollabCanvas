/**
 * First-sync initialization for a board doc: set the board title in `meta` if
 * it's not there yet. (Until Phase 4 this also seeded demo columns; real boards
 * start empty — the UI's empty state invites the first column.)
 */

import * as Y from "yjs";
import { getMeta } from "./schema";

export function ensureBoardMeta(doc: Y.Doc, title: string): void {
  const meta = getMeta(doc);
  doc.transact(() => {
    if (!meta.get("title")) meta.set("title", title);
  });
}
