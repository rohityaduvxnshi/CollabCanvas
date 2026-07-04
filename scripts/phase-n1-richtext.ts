/**
 * N1 headless harness — collaborative rich card descriptions.
 *
 * Pure CRDT-layer checks (doc↔doc sync via Y.applyUpdate; the WS transport is
 * already covered by phase1). Covers: fragmentToText extraction, legacy-string
 * migration, two-client convergence on one fragment, cardDescText precedence,
 * and history-restore semantics (in-place fragment rebuild, instance survival,
 * pre-rich-snapshot fallback).
 *
 * Run:  npx tsx scripts/phase-n1-richtext.ts
 */

import * as Y from "yjs";
import {
  CARD_DESC,
  cardDescFragment,
  cardDescText,
  ensureCardDescFragment,
  fragmentToText,
  getCards,
} from "../web/lib/yjs/schema";
import { createBoardActions } from "../web/lib/yjs/mutations";
import { deriveBoardView } from "../web/lib/yjs/deriveBoardView";
import { replaceDocFromSnapshot } from "../web/lib/yjs/restore";

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean) {
  console.log(`${ok ? "✅" : "❌"} ${name}`);
  ok ? passed++ : failed++;
}

/** Bidirectional full-state sync between two docs. */
function sync(a: Y.Doc, b: Y.Doc) {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
}

function p(text: string): Y.XmlElement {
  const el = new Y.XmlElement("paragraph");
  el.insert(0, [new Y.XmlText(text)]);
  return el;
}

function main() {
  // --- fragmentToText -------------------------------------------------------
  {
    const doc = new Y.Doc();
    const frag = doc.getXmlFragment("t");
    frag.insert(0, [p("hello"), p("world")]);
    check("text: blocks join with newline", fragmentToText(frag) === "hello\nworld");

    const bold = new Y.XmlElement("paragraph");
    const t = new Y.XmlText();
    bold.insert(0, [t]);
    frag.insert(2, [bold]);
    t.insert(0, "plain ");
    t.insert(6, "bold", { bold: true });
    check(
      "text: formatting marks dropped",
      fragmentToText(frag) === "hello\nworld\nplain bold",
    );

    const list = new Y.XmlElement("bulletList");
    const li1 = new Y.XmlElement("listItem");
    li1.insert(0, [p("one")]);
    const li2 = new Y.XmlElement("listItem");
    li2.insert(0, [p("two")]);
    list.insert(0, [li1, li2]);
    const frag2 = doc.getXmlFragment("t2");
    frag2.insert(0, [list]);
    check("text: nested list flattens to lines", fragmentToText(frag2) === "one\ntwo");
    doc.destroy();
  }

  // --- legacy migration -----------------------------------------------------
  {
    const doc = new Y.Doc();
    const actions = createBoardActions(doc);
    actions.addColumn("Col");
    const colId = deriveBoardView(doc).columns[0].id;
    actions.addCard(colId, "Card A");
    const cardId = deriveBoardView(doc).columns[0].cards[0].id;
    const card = getCards(doc).get(cardId)!;
    card.set("description", "line one\nline two");

    const frag = ensureCardDescFragment(doc, card);
    check("migrate: legacy string becomes paragraphs", fragmentToText(frag) === "line one\nline two");
    check("migrate: legacy string cleared", card.get("description") === "");
    check("migrate: idempotent (same instance)", ensureCardDescFragment(doc, card) === frag);
    check("preview: derive uses fragment text", deriveBoardView(doc).columns[0].cards[0].description === "line one\nline two");
    doc.destroy();
  }

  // --- two-client convergence ----------------------------------------------
  {
    const a = new Y.Doc();
    const actionsA = createBoardActions(a);
    actionsA.addColumn("Col");
    const colId = deriveBoardView(a).columns[0].id;
    actionsA.addCard(colId, "Card");
    const cardId = deriveBoardView(a).columns[0].cards[0].id;
    const fragA = ensureCardDescFragment(a, getCards(a).get(cardId)!);
    fragA.insert(0, [p("shared")]);

    const b = new Y.Doc();
    sync(a, b);
    const cardB = getCards(b).get(cardId)!;
    const fragB = cardDescFragment(cardB)!;
    check("sync: fragment arrives on client B", fragmentToText(fragB) === "shared");

    // Concurrent inserts into the SAME text node from both clients.
    const textA = (fragA.get(0) as Y.XmlElement).get(0) as Y.XmlText;
    const textB = (fragB.get(0) as Y.XmlElement).get(0) as Y.XmlText;
    textA.insert(0, "A:");
    textB.insert(textB.length, ":B");
    sync(a, b);
    const finalA = fragmentToText(fragA);
    const finalB = fragmentToText(fragB);
    check("concurrent: both clients converge", finalA === finalB);
    check(
      "concurrent: both edits survive",
      finalA.includes("A:") && finalA.includes(":B") && finalA.includes("shared"),
    );
    a.destroy();
    b.destroy();
  }

  // --- cardDescText precedence ----------------------------------------------
  {
    const doc = new Y.Doc();
    const actions = createBoardActions(doc);
    actions.addColumn("Col");
    const colId = deriveBoardView(doc).columns[0].id;
    actions.addCard(colId, "Card");
    const cardId = deriveBoardView(doc).columns[0].cards[0].id;
    const card = getCards(doc).get(cardId)!;
    card.set("description", "legacy");
    const frag = new Y.XmlFragment();
    card.set(CARD_DESC, frag); // empty fragment + legacy string
    check("preview: empty fragment falls back to legacy", cardDescText(card) === "legacy");
    frag.insert(0, [p("rich")]);
    check("preview: non-empty fragment wins", cardDescText(card) === "rich");

    // Preview is capped so a huge description doesn't produce a huge string
    // on every re-derive.
    const long = "x".repeat(1000);
    (frag.get(0) as Y.XmlElement).delete(0, 1);
    (frag.get(0) as Y.XmlElement).insert(0, [new Y.XmlText(long)]);
    check("preview: long text is capped", cardDescText(card).length <= 280);
    doc.destroy();
  }

  // --- restore: in-place fragment rebuild ------------------------------------
  {
    const doc = new Y.Doc();
    const actions = createBoardActions(doc);
    actions.addColumn("Col");
    const colId = deriveBoardView(doc).columns[0].id;
    actions.addCard(colId, "Card");
    const cardId = deriveBoardView(doc).columns[0].cards[0].id;
    const card = getCards(doc).get(cardId)!;
    const frag = ensureCardDescFragment(doc, card);
    frag.insert(0, [p("version one")]);

    const snapshot = Y.encodeStateAsUpdate(doc); // history point

    (frag.get(0) as Y.XmlElement).delete(0, 1);
    (frag.get(0) as Y.XmlElement).insert(0, [new Y.XmlText("diverged")]);
    check("restore setup: live diverged", fragmentToText(frag) === "diverged");

    replaceDocFromSnapshot(doc, snapshot);
    check("restore: fragment content restored", fragmentToText(frag) === "version one");
    check(
      "restore: fragment instance survived (in-place)",
      cardDescFragment(getCards(doc).get(cardId)!) === frag,
    );

    // The surviving instance must still accept edits that sync normally.
    frag.insert(frag.length, [p("post-restore")]);
    const other = new Y.Doc();
    sync(doc, other);
    check(
      "restore: post-restore edits still converge",
      fragmentToText(cardDescFragment(getCards(other).get(cardId)!)!) ===
        "version one\npost-restore",
    );
    doc.destroy();
    other.destroy();
  }

  // --- restore from a pre-rich snapshot --------------------------------------
  {
    const doc = new Y.Doc();
    const actions = createBoardActions(doc);
    actions.addColumn("Col");
    const colId = deriveBoardView(doc).columns[0].id;
    actions.addCard(colId, "Card");
    const cardId = deriveBoardView(doc).columns[0].cards[0].id;
    const card = getCards(doc).get(cardId)!;
    card.set("description", "old plain text");

    const preRichSnapshot = Y.encodeStateAsUpdate(doc);

    const frag = ensureCardDescFragment(doc, card); // migrates + clears legacy
    frag.insert(frag.length, [p("rich extra")]);

    replaceDocFromSnapshot(doc, preRichSnapshot);
    check(
      "restore(pre-rich): fragment emptied, legacy string is the preview",
      cardDescText(card) === "old plain text",
    );
    doc.destroy();
  }

  console.log(`\nphase-n1: ${passed}/${passed + failed} checks passed`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
