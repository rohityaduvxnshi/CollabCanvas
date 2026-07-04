/**
 * N2 page-room persistence harness. Single process against a running ws-server:
 *
 *   1. Connect to a `page:<id>` room, write rich content to the doc's default
 *      Y.XmlFragment (what TipTap Collaboration binds to), wait past the
 *      debounce, disconnect (flush).
 *   2. Assert the PageSnapshot row landed in Postgres and decodes to that
 *      content (DB persistence — the board path is unchanged; this proves the
 *      new page routing).
 *   3. A fresh client rejoining the room receives the content (load-on-join).
 *
 * Run (ws-server must be running):  npx tsx scripts/phase-n2-pages.ts
 */

import * as Y from "yjs";
import { WebSocket as WsWebSocket } from "ws";
import { WebsocketProvider } from "y-websocket";
import { mintEditorToken } from "./mintToken";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:4000";
const PAGE_ID = `n2-page-${Date.now()}`;
const ROOM = `page:${PAGE_ID}`;
const BODY = "Hello from a collaborative page.";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean) {
  console.log(`${ok ? "✅" : "❌"} ${name}`);
  ok ? passed++ : failed++;
}

async function ensurePageRow(pageId: string): Promise<void> {
  const { getPrisma } = await import("../packages/db/src/index");
  const prisma = getPrisma();
  const user = await prisma.user.upsert({
    where: { email: "harness@test.local" },
    create: { email: "harness@test.local", name: "Harness" },
    update: {},
  });
  await prisma.page.upsert({
    where: { id: pageId },
    create: { id: pageId, title: "Harness page", ownerId: user.id },
    update: {},
  });
}

async function connect() {
  const doc = new Y.Doc();
  const token = await mintEditorToken(ROOM);
  const provider = new WebsocketProvider(WS_URL, ROOM, doc, {
    disableBc: true,
    WebSocketPolyfill: WsWebSocket as unknown as typeof WebSocket,
    ...(token ? { params: { token } } : {}),
  });
  return { doc, provider };
}

function waitSynced(provider: WebsocketProvider): Promise<void> {
  if (provider.synced) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const onSync = (s: boolean) => {
      if (s) {
        provider.off("sync", onSync);
        resolve();
      }
    };
    provider.on("sync", onSync);
  });
}

/** Plain text of a default-fragment (paragraph nodes with a text child). */
function fragText(frag: Y.XmlFragment): string {
  return frag
    .toArray()
    .map((node) => {
      if (node instanceof Y.XmlElement) {
        return node
          .toArray()
          .map((c) => (c instanceof Y.XmlText ? c.toString() : ""))
          .join("");
      }
      return node instanceof Y.XmlText ? node.toString() : "";
    })
    .join("\n");
}

async function main() {
  await ensurePageRow(PAGE_ID);

  // --- 1. write -------------------------------------------------------------
  const a = await connect();
  await waitSynced(a.provider);
  const fragA = a.doc.getXmlFragment("default");
  const para = new Y.XmlElement("paragraph");
  para.insert(0, [new Y.XmlText(BODY)]);
  fragA.insert(0, [para]);
  check("wrote content to page fragment", fragText(fragA) === BODY);

  await sleep(4500); // outlive the 3s debounce so the snapshot lands
  a.provider.destroy();
  a.doc.destroy();
  await sleep(1500); // last-disconnect flush + evict

  // --- 2. assert the PageSnapshot persisted --------------------------------
  const { getPrisma } = await import("../packages/db/src/index");
  const row = await getPrisma().pageSnapshot.findUnique({
    where: { pageId: PAGE_ID },
  });
  check("PageSnapshot row exists in Postgres", !!row);
  if (row) {
    const decoded = new Y.Doc();
    Y.applyUpdate(decoded, new Uint8Array(row.state));
    check(
      "persisted snapshot decodes to the written content",
      fragText(decoded.getXmlFragment("default")) === BODY,
    );
    decoded.destroy();
  } else {
    check("persisted snapshot decodes to the written content", false);
  }

  // --- 3. a fresh client reloads it ----------------------------------------
  const b = await connect();
  await waitSynced(b.provider);
  await sleep(1200); // snapshot load is async server-side
  check(
    "fresh client reloads the page content",
    fragText(b.doc.getXmlFragment("default")) === BODY,
  );
  b.provider.destroy();
  b.doc.destroy();

  // --- cleanup --------------------------------------------------------------
  await sleep(300);
  await getPrisma().page.delete({ where: { id: PAGE_ID } }).catch(() => {});

  console.log(`\nphase-n2: ${passed}/${passed + failed} checks passed`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
