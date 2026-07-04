"use client";

/**
 * DatabaseTable (N4) — pure presentational grid for a typed database. Renders a
 * `DbView` and calls the `DbActions` it's given. ZERO Yjs (spec §0.1): all
 * edits go through the actions callbacks. Read-only when `actions` is null.
 */

import {
  DB_COLUMN_TYPES,
  type DbActions,
  type DbColumnView,
  type DbRowView,
  type DbView,
} from "@collabcanvas/shared";
import { AttachmentCell } from "./AttachmentCell";

const TYPE_LABEL: Record<string, string> = {
  text: "Aa",
  number: "#",
  select: "▼",
  date: "📅",
  checkbox: "✓",
};

const CELL =
  "w-full min-w-[80px] border-0 bg-transparent px-2 py-1.5 font-sans text-[12.5px] text-[var(--ink)] outline-none";

function Cell({
  col,
  value,
  onSet,
  databaseId,
  canEdit,
}: {
  col: DbColumnView;
  value: string | number | boolean | undefined;
  onSet: (v: string | number | boolean | null) => void;
  databaseId: string;
  canEdit: boolean;
}) {
  if (col.type === "attachment") {
    return (
      <AttachmentCell
        databaseId={databaseId}
        value={value}
        canEdit={canEdit}
        onChange={onSet}
      />
    );
  }
  if (col.type === "formula") {
    // Computed + read-only; deriveDbView already put the value in the cell.
    const text = value === undefined ? "" : typeof value === "boolean" ? (value ? "true" : "false") : String(value);
    const isErr = typeof text === "string" && text.startsWith("#ERR");
    return (
      <div
        className={`px-2 py-1.5 font-sans text-[12.5px] ${isErr ? "text-[var(--coral)]" : "text-[var(--ink-soft)]"}`}
        title="Computed column"
      >
        {text}
      </div>
    );
  }
  switch (col.type) {
    case "checkbox":
      return (
        <input
          type="checkbox"
          checked={value === true}
          onChange={(e) => onSet(e.target.checked)}
          className="ml-2 h-[15px] w-[15px] accent-[var(--teal)]"
        />
      );
    case "number":
      return (
        <input
          type="number"
          defaultValue={value === undefined ? "" : String(value)}
          onBlur={(e) => onSet(e.target.value === "" ? null : Number(e.target.value))}
          className={CELL}
          key={String(value)}
        />
      );
    case "date":
      return (
        <input
          type="date"
          defaultValue={typeof value === "string" ? value : ""}
          onChange={(e) => onSet(e.target.value || null)}
          className={CELL}
        />
      );
    case "select":
      return (
        <select
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onSet(e.target.value || null)}
          className={CELL}
        >
          <option value="">—</option>
          {col.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
    default:
      return (
        <input
          type="text"
          defaultValue={typeof value === "string" ? value : ""}
          onBlur={(e) => onSet(e.target.value)}
          className={CELL}
          key={String(value)}
        />
      );
  }
}

export function DatabaseTable({
  data,
  actions,
  databaseId,
}: {
  data: DbView;
  actions: DbActions | null;
  databaseId: string;
}) {
  const editable = actions !== null;

  // Deleting a row must reclaim the attachments it referenced, or those files
  // strand the owner's storage quota with no UI to free them (N5 review). Safe
  // because there's no row-duplication feature, so each attachment id lives in
  // exactly one cell; a future duplicate-row feature would need ref-counting.
  const deleteRowWithAttachments = async (row: DbRowView) => {
    const ids: string[] = [];
    for (const col of data.columns) {
      if (col.type !== "attachment") continue;
      const v = row.cells[col.id];
      if (typeof v !== "string") continue;
      try {
        for (const f of JSON.parse(v)) if (f && typeof f.id === "string") ids.push(f.id);
      } catch {
        /* malformed cell — nothing to reclaim */
      }
    }
    await Promise.all(
      ids.map((id) => fetch(`/api/attachments/${id}`, { method: "DELETE" }).catch(() => {})),
    );
    actions?.deleteRow(row.id);
  };

  return (
    <div className="overflow-x-auto rounded-2xl border-[2.5px] border-[var(--line)] bg-[var(--surface)] shadow-[4px_4px_0_var(--shadow)]">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b-[2.5px] border-[var(--line)] bg-[var(--surface-2)]">
            {data.columns.map((col) => (
              <th
                key={col.id}
                className="min-w-[140px] border-r-2 border-[var(--line)] px-2 py-1.5 text-left align-top"
              >
                <div className="flex items-center gap-1">
                  <span className="font-mono text-[10px] text-[var(--ink-faint)]" title={col.type}>
                    {TYPE_LABEL[col.type] ?? "Aa"}
                  </span>
                  <input
                    defaultValue={col.name}
                    readOnly={!editable}
                    onBlur={(e) => actions?.renameColumn(col.id, e.target.value)}
                    className="min-w-0 flex-1 bg-transparent font-display text-[12.5px] font-semibold text-[var(--ink)] outline-none"
                    aria-label={`Column ${col.name} name`}
                  />
                  {editable ? (
                    <>
                      <select
                        value={col.type}
                        onChange={(e) => actions?.changeColumnType(col.id, e.target.value as never)}
                        aria-label="Column type"
                        className="bg-transparent font-mono text-[10px] text-[var(--ink-soft)] outline-none"
                      >
                        {DB_COLUMN_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={() => actions?.deleteColumn(col.id)}
                        title="Delete column"
                        className="px-1 font-sans text-[11px] font-semibold text-[var(--coral)]"
                      >
                        ✕
                      </button>
                    </>
                  ) : null}
                </div>
                {col.type === "select" && editable ? (
                  <input
                    defaultValue={col.options.join(", ")}
                    onBlur={(e) =>
                      actions?.setSelectOptions(
                        col.id,
                        e.target.value.split(",").map((s) => s.trim()),
                      )
                    }
                    placeholder="option1, option2…"
                    aria-label="Select options"
                    className="mt-1 w-full rounded border border-[var(--line)] bg-[var(--paper)] px-1.5 py-0.5 font-sans text-[10.5px] text-[var(--ink-soft)] outline-none"
                    key={col.options.join(",")}
                  />
                ) : null}
                {col.type === "formula" && editable ? (
                  <input
                    defaultValue={col.formula ?? ""}
                    onBlur={(e) => actions?.setColumnFormula(col.id, e.target.value)}
                    placeholder="e.g. [Price] * [Qty]"
                    aria-label="Formula expression"
                    className="mt-1 w-full rounded border border-[var(--line)] bg-[var(--paper)] px-1.5 py-0.5 font-mono text-[10.5px] text-[var(--ink-soft)] outline-none"
                    key={col.formula}
                  />
                ) : null}
              </th>
            ))}
            {editable ? (
              <th className="px-2 py-1.5">
                <button
                  onClick={() => actions?.addColumn("Column", "text")}
                  className="cc-press rounded-[8px] border-2 border-[var(--line)] bg-[var(--surface)] px-2 py-1 font-display text-[12px] font-semibold text-[var(--ink)] shadow-[2px_2px_0_var(--shadow)]"
                >
                  + Column
                </button>
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row) => (
            <tr key={row.id} className="group border-b-2 border-[var(--line)]">
              {data.columns.map((col) => (
                <td key={col.id} className="border-r-2 border-[var(--line)] align-middle">
                  <Cell
                    col={col}
                    value={row.cells[col.id]}
                    onSet={(v) => actions?.setCell(row.id, col.id, v)}
                    databaseId={databaseId}
                    canEdit={editable}
                  />
                </td>
              ))}
              {editable ? (
                <td className="px-2 text-center">
                  <button
                    onClick={() => void deleteRowWithAttachments(row)}
                    title="Delete row"
                    className="hidden font-sans text-[11px] font-semibold text-[var(--coral)] group-hover:inline"
                  >
                    ✕
                  </button>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
      {editable ? (
        <button
          onClick={() => actions?.addRow()}
          className="w-full border-t-2 border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 text-left font-display text-[12.5px] font-semibold text-[var(--ink-soft)] hover:bg-[var(--sunk)]"
        >
          + New row
        </button>
      ) : null}
    </div>
  );
}
