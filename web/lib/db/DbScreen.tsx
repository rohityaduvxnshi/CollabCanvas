"use client";

/**
 * DbScreen (N4) — chrome around the database table: back link, editable title
 * (renames via server action), a connection-status pill, and the collaborative
 * grid. Client component in the lib/db seam (reads useDatabase for status).
 */

import { useState } from "react";
import Link from "next/link";
import { renameDatabaseAction } from "@/lib/actions";
import { ExportButtons } from "@/components/ExportButtons";
import { databaseToCsv, databaseToHtml } from "@/lib/exporters";
import { downloadText, printHtml, safeName } from "@/lib/download";
import { DbViewPanel } from "./DbViewPanel";
import { useDatabase, useDbRoom } from "./DbRoomProvider";

const STATUS: Record<string, { label: string; bg: string }> = {
  connecting: { label: "Connecting…", bg: "var(--band-sun)" },
  connected: { label: "Live", bg: "var(--band-teal)" },
  disconnected: { label: "Reconnecting…", bg: "var(--band-coral)" },
  offline: { label: "Offline", bg: "var(--pill-off)" },
};

export function DbScreen({ initialTitle }: { initialTitle: string }) {
  const { databaseId } = useDbRoom();
  const { data, actions, status, canEdit } = useDatabase();
  const [title, setTitle] = useState(initialTitle);
  const pill = STATUS[status] ?? STATUS.connecting;

  const commitTitle = () => {
    const next = title.trim() || "Untitled database";
    if (next !== title) setTitle(next);
    if (canEdit) void renameDatabaseAction(databaseId, next);
  };

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex flex-none items-center gap-3 border-b-[2.5px] border-[var(--line)] bg-[var(--surface)] px-5 py-3">
        <Link
          href="/"
          className="cc-press rounded-[9px] border-2 border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-1.5 font-sans text-[12.5px] font-semibold text-[var(--ink)] shadow-[2px_2px_0_var(--shadow)]"
        >
          ← All spaces
        </Link>
        <span className="text-lg">🗃️</span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          readOnly={!canEdit}
          aria-label="Database title"
          className="min-w-0 flex-1 bg-transparent font-display text-lg font-semibold text-[var(--ink)] outline-none"
          placeholder="Untitled database"
        />
        <span className="flex-none font-mono text-[11px] text-[var(--ink-faint)]">
          {data.rows.length} rows · {data.columns.length} cols
        </span>
        <ExportButtons
          items={[
            {
              label: "CSV",
              title: "Comma-separated — opens in Excel",
              onClick: () => downloadText(`${safeName(title)}.csv`, databaseToCsv(data), "text/csv"),
            },
            {
              label: "Word",
              title: "HTML document — opens in Word",
              onClick: () => downloadText(`${safeName(title)}.doc`, databaseToHtml(data), "application/msword"),
            },
            { label: "PDF", title: "Print → Save as PDF", onClick: () => printHtml(databaseToHtml(data)) },
          ]}
        />
        <span
          className="flex-none rounded-full border-2 border-[var(--line)] px-2.5 py-0.5 font-sans text-[11px] font-bold text-[#1c1a17]"
          style={{ background: pill.bg }}
        >
          {pill.label}
        </span>
      </header>

      <div className="cc-dots min-h-0 flex-1 overflow-auto p-6">
        <DbViewPanel data={data} actions={actions} databaseId={databaseId} canEdit={canEdit} />
      </div>
    </div>
  );
}
