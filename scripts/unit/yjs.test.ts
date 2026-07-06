/**
 * Phase 6 unit tests — the CRDT logic that would actually break (spec: "test
 * the logic that would actually break, don't chase coverage").
 *
 * Run:  npm run test:unit   (tsx --test, Node's built-in runner)
 *
 * Two-doc merges simulate concurrency without a server: each doc mutates
 * independently, then updates are exchanged both ways (order-independent).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as Y from "yjs";
import { LIMITS } from "@collabcanvas/shared";
import { createBoardActions } from "../../web/lib/yjs/mutations";
import { deriveBoardView } from "../../web/lib/yjs/deriveBoardView";
import { replaceDocFromSnapshot } from "../../web/lib/yjs/restore";
import {
  colCardOrder,
  getCards,
  getColumnOrder,
  getColumns,
  makeCard,
  makeColumn,
} from "../../web/lib/yjs/schema";
import { rateLimit } from "../../web/lib/rateLimit";
import { PresenceStore } from "../../web/lib/board/presenceStore";

/** Exchange updates both ways — both docs converge to the merged state. */
function syncDocs(a: Y.Doc, b: Y.Doc): void {
  const ua = Y.encodeStateAsUpdate(a);
  const ub = Y.encodeStateAsUpdate(b);
  Y.applyUpdate(a, ub);
  Y.applyUpdate(b, ua);
}

/** A doc with one column ("col1") holding cards c1..cN. */
function seedDoc(cardCount: number): Y.Doc {
  const doc = new Y.Doc();
  const columns = getColumns(doc);
  const cards = getCards(doc);
  doc.transact(() => {
    columns.set("col1", makeColumn("col1", "Col 1"));
    const order = colCardOrder(columns.get("col1")!);
    for (let i = 1; i <= cardCount; i++) {
      cards.set(`c${i}`, makeCard(`c${i}`, `Card ${i}`));
      order.push([`c${i}`]);
    }
    getColumnOrder(doc).push(["col1"]);
  });
  return doc;
}

// ---------------------------------------------------------------------------
// deriveBoardView edge cases (spec §3 — "document them, don't ignore them")
// ---------------------------------------------------------------------------

test("deriveBoardView: card in two columns renders once, in the earlier column", () => {
  const doc = seedDoc(1);
  const columns = getColumns(doc);
  doc.transact(() => {
    columns.set("col2", makeColumn("col2", "Col 2"));
    colCardOrder(columns.get("col2")!).push(["c1"]); // duplicate reference
    getColumnOrder(doc).push(["col2"]);
  });
  const view = deriveBoardView(doc);
  assert.equal(view.columns[0].cards.length, 1);
  assert.equal(view.columns[1].cards.length, 0);
});

test("deriveBoardView: orphan card entities are not rendered", () => {
  const doc = seedDoc(1);
  getCards(doc).set("orphan", makeCard("orphan", "Nobody references me"));
  const view = deriveBoardView(doc);
  assert.deepEqual(
    view.columns.flatMap((c) => c.cards.map((x) => x.id)),
    ["c1"],
  );
});

test("deriveBoardView: order entries without entities are skipped", () => {
  const doc = seedDoc(1);
  doc.transact(() => {
    colCardOrder(getColumns(doc).get("col1")!).push(["ghost-card"]);
    getColumnOrder(doc).push(["ghost-column"]);
  });
  const view = deriveBoardView(doc);
  assert.equal(view.columns.length, 1);
  assert.equal(view.columns[0].cards.length, 1);
});

test("deriveBoardView: duplicate columnOrder entries render once", () => {
  const doc = seedDoc(1);
  getColumnOrder(doc).push(["col1"]); // duplicate
  assert.equal(deriveBoardView(doc).columns.length, 1);
});

// ---------------------------------------------------------------------------
// Mutation semantics
// ---------------------------------------------------------------------------

test("moveCard: same-column downward move follows arrayMove semantics", () => {
  const doc = seedDoc(3); // [c1, c2, c3]
  createBoardActions(doc).moveCard("c1", "col1", 2);
  assert.deepEqual(
    deriveBoardView(doc).columns[0].cards.map((c) => c.id),
    ["c2", "c3", "c1"],
  );
});

test("moveColumn: adjacent swap is not a no-op ([A,B] → [B,A])", () => {
  const doc = seedDoc(0);
  const columns = getColumns(doc);
  doc.transact(() => {
    columns.set("col2", makeColumn("col2", "Col 2"));
    getColumnOrder(doc).push(["col2"]);
  });
  createBoardActions(doc).moveColumn("col1", 1);
  assert.deepEqual(
    deriveBoardView(doc).columns.map((c) => c.id),
    ["col2", "col1"],
  );
});

test("moveColumn: heals duplicated columnOrder entries", () => {
  const doc = seedDoc(0);
  const columns = getColumns(doc);
  doc.transact(() => {
    columns.set("col2", makeColumn("col2", "Col 2"));
    getColumnOrder(doc).push(["col2"]);
    getColumnOrder(doc).push(["col1"]); // duplicate (concurrent-restore artifact)
  });
  createBoardActions(doc).moveColumn("col1", 1);
  assert.deepEqual(getColumnOrder(doc).toArray(), ["col2", "col1"]);
});

test("concurrent same-card move to different columns converges, no dup/loss", () => {
  const docA = seedDoc(1);
  const colsA = getColumns(docA);
  docA.transact(() => {
    colsA.set("col2", makeColumn("col2", "Col 2"));
    colsA.set("col3", makeColumn("col3", "Col 3"));
    getColumnOrder(docA).push(["col2", "col3"]);
  });
  const docB = new Y.Doc();
  Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

  createBoardActions(docA).moveCard("c1", "col2", 0);
  createBoardActions(docB).moveCard("c1", "col3", 0);
  syncDocs(docA, docB);

  const viewA = deriveBoardView(docA);
  const viewB = deriveBoardView(docB);
  assert.deepEqual(viewA, viewB);
  const count = viewA.columns.reduce(
    (n, c) => n + c.cards.filter((x) => x.id === "c1").length,
    0,
  );
  assert.equal(count, 1);
});

test("deleteColumn concurrent with moveCard keeps the moved card", () => {
  const docA = seedDoc(1);
  getColumns(docA).set("col2", makeColumn("col2", "Col 2"));
  getColumnOrder(docA).push(["col2"]);
  const docB = new Y.Doc();
  Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

  createBoardActions(docA).moveCard("c1", "col2", 0); // A moves out…
  createBoardActions(docB).deleteColumn("col1"); // …while B deletes the source
  syncDocs(docA, docB);

  const viewA = deriveBoardView(docA);
  assert.deepEqual(viewA, deriveBoardView(docB));
  assert.deepEqual(
    viewA.columns.flatMap((c) => c.cards.map((x) => x.id)),
    ["c1"],
  );
});

// ---------------------------------------------------------------------------
// Restore (in-place rebuild)
// ---------------------------------------------------------------------------

test("restore keeps a card added concurrently by another client", () => {
  const docA = seedDoc(2);
  const snapshot = Y.encodeStateAsUpdate(docA);
  const docB = new Y.Doc();
  Y.applyUpdate(docB, snapshot);

  createBoardActions(docA).addCard("col1", "Added concurrently"); // A adds…
  replaceDocFromSnapshot(docB, snapshot); // …while B restores
  syncDocs(docA, docB);

  const titles = deriveBoardView(docA).columns[0].cards.map((c) => c.title);
  assert.ok(titles.includes("Added concurrently"));
  assert.deepEqual(deriveBoardView(docA), deriveBoardView(docB));
});

test("restore removes post-snapshot cards and restores order", () => {
  const doc = seedDoc(2);
  const snapshot = Y.encodeStateAsUpdate(doc);
  const actions = createBoardActions(doc);
  actions.addCard("col1", "Post-snapshot");
  actions.moveCard("c2", "col1", 0);
  replaceDocFromSnapshot(doc, snapshot);
  assert.deepEqual(
    deriveBoardView(doc).columns[0].cards.map((c) => c.id),
    ["c1", "c2"],
  );
});

// ---------------------------------------------------------------------------
// Phase 6 caps + rate limiter
// ---------------------------------------------------------------------------

test("caps: addColumn stops at LIMITS.columnsPerBoard", () => {
  const doc = new Y.Doc();
  const actions = createBoardActions(doc);
  for (let i = 0; i < LIMITS.columnsPerBoard + 5; i++) actions.addColumn(`Col ${i}`);
  assert.equal(deriveBoardView(doc).columns.length, LIMITS.columnsPerBoard);
});

test("caps: orphan entities from deleted columns don't eat the card budget", () => {
  const doc = seedDoc(0);
  const actions = createBoardActions(doc);
  // Fill a second column, then delete it — its cards become invisible orphans.
  actions.addColumn("Doomed");
  const doomedId = deriveBoardView(doc).columns.find((c) => c.title === "Doomed")!.id;
  for (let i = 0; i < 20; i++) actions.addCard(doomedId, `doomed ${i}`);
  actions.deleteColumn(doomedId);
  assert.equal(getCards(doc).size, 20); // entities remain (concurrent-move safety)…
  actions.addCard("col1", "still under the cap");
  // …but the cap counts VISIBLE cards, so adding still works.
  assert.ok(
    deriveBoardView(doc)
      .columns[0].cards.some((c) => c.title === "still under the cap"),
  );
});

test("caps: titles and descriptions are length-clamped", () => {
  const doc = seedDoc(1);
  const actions = createBoardActions(doc);
  actions.updateCard("c1", {
    title: "x".repeat(LIMITS.cardTitle + 100),
    description: "y".repeat(LIMITS.cardDescription + 100),
  });
  const card = deriveBoardView(doc).columns[0].cards[0];
  assert.equal(card.title.length, LIMITS.cardTitle);
  assert.equal(card.description.length, LIMITS.cardDescription);
});

test("rateLimit: allows up to max, blocks beyond, recovers after the window", async () => {
  const key = `test-${Date.now()}`;
  for (let i = 0; i < 5; i++) assert.equal(rateLimit(key, 5, 200), true);
  assert.equal(rateLimit(key, 5, 200), false);
  await new Promise((r) => setTimeout(r, 250));
  assert.equal(rateLimit(key, 5, 200), true);
});

// Regression: the mouse position must NOT occupy the awareness `cursor` field.
// TipTap's CollaborationCaret (rich card descriptions, N1) shares the room
// awareness and HARDCODES reading `state.cursor` as a ProseMirror relative
// position ({anchor, head}); a {x,y} mouse point there makes it call
// createRelativePositionFromJSON(undefined) and crash the editor for every peer
// with "Cannot read properties of undefined (reading 'type')" (observed live).
test("presence: mouse lives under `pointer`, never `cursor` (TipTap owns cursor)", () => {
  const writes: string[] = [];
  const state: Record<string, unknown> = {};
  const fakeAwareness = {
    clientID: 1,
    states: new Map<number, unknown>(),
    setLocalState(s: Record<string, unknown>) {
      for (const k of Object.keys(state)) delete state[k];
      Object.assign(state, s);
      this.states.set(this.clientID, state);
    },
    setLocalStateField(f: string, v: unknown) {
      writes.push(f);
      state[f] = v;
      this.states.set(this.clientID, state);
    },
    getStates() {
      return this.states;
    },
    on() {},
    off() {},
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ps = new PresenceStore(fakeAwareness as any, {
    id: "u1",
    name: "U",
    color: "#ef4444",
  });
  ps.setCursor(12, 34); // leading-edge flush is synchronous (lastFlushAt = 0)
  ps.setEditing("card-1");

  assert.ok(!("cursor" in state), "app must never write the awareness `cursor` field");
  assert.deepEqual(state.pointer, { x: 12, y: 34 }, "mouse position lands under `pointer`");
  assert.ok(writes.includes("pointer") && !writes.includes("cursor"));
  ps.destroy();
});

// N9: files attach to cards + columns as a denormalized FileRef[] and surface
// through deriveBoardView; the mutation sanitizes (name length) and clamps the
// count so a hostile/oversized list can't bloat the doc.
test("N9: card + column files round-trip through the view (sanitized + clamped)", () => {
  const doc = seedDoc(1);
  const actions = createBoardActions(doc);
  actions.setCardFiles("c1", [
    { id: "a1", name: "photo.png", size: 1234 },
    { id: "a2", name: "x".repeat(400), size: 9 },
  ]);
  actions.setColumnFiles("col1", [{ id: "b1", name: "spec.pdf", size: 999 }]);

  const view = deriveBoardView(doc);
  const card = view.columns[0].cards[0];
  assert.equal(card.files.length, 2);
  assert.equal(card.files[0].id, "a1");
  assert.equal(card.files[1].name.length, 255); // name clamped
  assert.equal(view.columns[0].files[0].id, "b1");

  // Count is clamped to the per-container cap.
  actions.setCardFiles(
    "c1",
    Array.from({ length: LIMITS.attachmentsPerCell + 5 }, (_, i) => ({
      id: `f${i}`,
      name: `f${i}`,
      size: 1,
    })),
  );
  assert.equal(
    deriveBoardView(doc).columns[0].cards[0].files.length,
    LIMITS.attachmentsPerCell,
  );

  // Detach clears the list.
  actions.setCardFiles("c1", []);
  assert.equal(deriveBoardView(doc).columns[0].cards[0].files.length, 0);
});
