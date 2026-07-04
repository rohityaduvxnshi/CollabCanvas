/**
 * N4 typed-database harness. Two parts:
 *   1. Pure Yjs layer (no servers): seed, typed-cell coercion, select options,
 *      column/row CRUD, delete cleans cells, reorder, caps, 2-client
 *      convergence, derive dedupe.
 *   2. Persistence round-trip (needs the ws-server): write a `db:<id>` room →
 *      DatabaseSnapshot row in Postgres → decodes → fresh client reloads.
 *
 * Run (ws-server must be running):  npx tsx scripts/phase-n4-databases.ts
 */

process.loadEnvFile("packages/db/.env");

import * as Y from "yjs";
import { WebSocket as WsWebSocket } from "ws";
import { WebsocketProvider } from "y-websocket";
import { LIMITS } from "@collabcanvas/shared";
import { createDbActions } from "../web/lib/yjs/dbMutations";
import { deriveDbView } from "../web/lib/yjs/deriveDbView";
import { ensureDbSeed } from "../web/lib/yjs/dbSeed";
import { getDbColumnOrder } from "../web/lib/yjs/dbSchema";
import { mintEditorToken } from "./mintToken";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:4000";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean) {
  console.log(`${ok ? "✅" : "❌"} ${name}`);
  ok ? passed++ : failed++;
}

function pure() {
  // --- seed ---------------------------------------------------------------
  const doc = new Y.Doc();
  ensureDbSeed(doc, "My DB");
  let view = deriveDbView(doc);
  check("seed: title set", view.title === "My DB");
  check("seed: 3 starter columns", view.columns.length === 3);
  check("seed: Status is a select with options", view.columns[1].type === "select" && view.columns[1].options.length === 3);
  check("seed: 1 starter row", view.rows.length === 1);
  check("seed: idempotent", (ensureDbSeed(doc, "My DB"), deriveDbView(doc).columns.length === 3));

  const actions = createDbActions(doc);
  const [nameCol, statusCol, doneCol] = deriveDbView(doc).columns;
  const rowId = deriveDbView(doc).rows[0].id;

  // --- typed cell coercion ------------------------------------------------
  actions.addColumn("Count", "number");
  const countCol = deriveDbView(doc).columns.find((c) => c.name === "Count")!;
  actions.setCell(rowId, nameCol.id, "First task");
  actions.setCell(rowId, countCol.id, "42");
  actions.setCell(rowId, doneCol.id, "true");
  actions.setCell(rowId, statusCol.id, "In progress");
  view = deriveDbView(doc);
  const cells = view.rows[0].cells;
  check("cell: text stays string", cells[nameCol.id] === "First task");
  check("cell: number coerced to number", cells[countCol.id] === 42);
  check("cell: checkbox coerced to boolean", cells[doneCol.id] === true);
  check("cell: select stored as string", cells[statusCol.id] === "In progress");

  actions.setCell(rowId, nameCol.id, "");
  check("cell: empty clears the value", deriveDbView(doc).rows[0].cells[nameCol.id] === undefined);

  // --- select options in place -------------------------------------------
  actions.setSelectOptions(statusCol.id, ["A", "B", "C", "D"]);
  check("options: replaced in place", deriveDbView(doc).columns[1].options.join(",") === "A,B,C,D");
  actions.setSelectOptions(statusCol.id, ["X", "X", "Y", "", "Y"]);
  check("options: duplicates + blanks removed", deriveDbView(doc).columns[1].options.join(",") === "X,Y");

  // --- delete column cleans its cells ------------------------------------
  actions.setCell(rowId, countCol.id, 7);
  actions.deleteColumn(countCol.id);
  view = deriveDbView(doc);
  check("deleteColumn: column gone", !view.columns.some((c) => c.id === countCol.id));
  check("deleteColumn: cell cleaned from row", view.rows[0].cells[countCol.id] === undefined);

  // --- reorder ------------------------------------------------------------
  actions.moveColumn(doneCol.id, 0);
  check("moveColumn: Done is now first", deriveDbView(doc).columns[0].id === doneCol.id);
  actions.addRow();
  const row2 = deriveDbView(doc).rows[1].id;
  actions.moveRow(row2, 0);
  check("moveRow: row2 is now first", deriveDbView(doc).rows[0].id === row2);

  // --- caps ---------------------------------------------------------------
  for (let i = 0; i < LIMITS.dbColumns + 5; i++) actions.addColumn(`c${i}`, "text");
  check("cap: columns stop at dbColumns", deriveDbView(doc).columns.length === LIMITS.dbColumns);

  // --- reseed guard: an emptied table must NOT be re-seeded ---------------
  const rg = new Y.Doc();
  ensureDbSeed(rg, "R");
  const rgActions = createDbActions(rg);
  for (const c of deriveDbView(rg).columns) rgActions.deleteColumn(c.id);
  check("reseed guard: emptied table has 0 columns", deriveDbView(rg).columns.length === 0);
  ensureDbSeed(rg, "R"); // must be a no-op (meta 'seeded' flag)
  check("reseed guard: ensureDbSeed does NOT resurrect the starter schema", deriveDbView(rg).columns.length === 0);
  rg.destroy();

  // --- derive dedupe ------------------------------------------------------
  const dupId = deriveDbView(doc).columns[0].id;
  getDbColumnOrder(doc).push([dupId]); // duplicate id in order
  const cnt = deriveDbView(doc).columns.filter((c) => c.id === dupId).length;
  check("derive: duplicate column id renders once", cnt === 1);

  doc.destroy();

  // --- 2-client convergence ----------------------------------------------
  const a = new Y.Doc();
  ensureDbSeed(a, "Shared");
  const b = new Y.Doc();
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  const aAct = createDbActions(a);
  const bAct = createDbActions(b);
  const aRow = deriveDbView(a).rows[0].id;
  const aCols = deriveDbView(a).columns;
  aAct.setCell(aRow, aCols[0].id, "from A");
  bAct.setCell(aRow, aCols[2].id, true); // different cell, different client
  aAct.addRow();
  bAct.addRow();
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  const va = deriveDbView(a);
  const vb = deriveDbView(b);
  check("converge: both clients agree on row count", va.rows.length === vb.rows.length);
  check("converge: both concurrent rows survive", va.rows.length === 3);
  check("converge: both concurrent cell edits survive", va.rows[0].cells[aCols[0].id] === "from A" && va.rows[0].cells[aCols[2].id] === true);
  a.destroy();
  b.destroy();

  // --- concurrent INDEPENDENT seeding converges (deterministic seed ids) --
  const s1 = new Y.Doc();
  const s2 = new Y.Doc();
  ensureDbSeed(s1, "T"); // both seed a brand-new db without syncing first
  ensureDbSeed(s2, "T");
  Y.applyUpdate(s1, Y.encodeStateAsUpdate(s2));
  Y.applyUpdate(s2, Y.encodeStateAsUpdate(s1));
  const sv = deriveDbView(s1);
  check("seed race: independent seeds converge to ONE schema (3 cols)", sv.columns.length === 3);
  check("seed race: converge to ONE row", sv.rows.length === 1);
  check("seed race: Status options not duplicated", sv.columns[1].options.length === 3);
  s1.destroy();
  s2.destroy();
}

async function persistence() {
  const dbId = `n4-db-${Date.now()}`;
  const room = `db:${dbId}`;
  const { getPrisma } = await import("../packages/db/src/index");
  const prisma = getPrisma();
  const user = await prisma.user.upsert({
    where: { email: "harness@test.local" },
    create: { email: "harness@test.local", name: "Harness" },
    update: {},
  });
  await prisma.database.upsert({
    where: { id: dbId },
    create: { id: dbId, title: "Harness DB", ownerId: user.id },
    update: {},
  });

  const connect = async () => {
    const doc = new Y.Doc();
    const token = await mintEditorToken(room);
    const provider = new WebsocketProvider(WS_URL, room, doc, {
      disableBc: true,
      WebSocketPolyfill: WsWebSocket as unknown as typeof WebSocket,
      ...(token ? { params: { token } } : {}),
    });
    await new Promise<void>((resolve) => {
      if (provider.synced) return resolve();
      provider.on("sync", (s: boolean) => s && resolve());
    });
    return { doc, provider };
  };

  const a = await connect();
  ensureDbSeed(a.doc, "Harness DB");
  createDbActions(a.doc).setCell(
    deriveDbView(a.doc).rows[0].id,
    deriveDbView(a.doc).columns[0].id,
    "persisted cell",
  );
  await sleep(4500);
  a.provider.destroy();
  a.doc.destroy();
  await sleep(1500);

  const row = await prisma.databaseSnapshot.findUnique({ where: { databaseId: dbId } });
  check("persist: DatabaseSnapshot row exists", !!row);
  if (row) {
    const decoded = new Y.Doc();
    Y.applyUpdate(decoded, new Uint8Array(row.state));
    const v = deriveDbView(decoded);
    check("persist: snapshot decodes to seeded schema + cell", v.columns.length === 3 && v.rows[0].cells[v.columns[0].id] === "persisted cell");
    decoded.destroy();
  } else {
    check("persist: snapshot decodes to seeded schema + cell", false);
  }

  const b = await connect();
  await sleep(1200);
  check("persist: fresh client reloads the database", deriveDbView(b.doc).rows[0]?.cells[deriveDbView(b.doc).columns[0].id] === "persisted cell");
  b.provider.destroy();
  b.doc.destroy();
  await sleep(200);
  await prisma.database.delete({ where: { id: dbId } }).catch(() => {});
}

async function main() {
  pure();
  await persistence();
  console.log(`\nphase-n4: ${passed}/${passed + failed} checks passed`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
