"use client";

/**
 * PageScreen (N2) — chrome around the full-page editor: back link, editable
 * title (renames via server action on blur/Enter), a connection-status pill,
 * and the collaborative body. Client component in the lib/page seam (reads
 * usePageRoom for status).
 */

import { useState } from "react";
import Link from "next/link";
import { renamePageAction } from "@/lib/actions";
import { usePageRoom } from "./PageRoomProvider";
import { PageEditor } from "./PageEditor";

const STATUS: Record<string, { label: string; bg: string }> = {
  connecting: { label: "Connecting…", bg: "var(--band-sun)" },
  connected: { label: "Live", bg: "var(--band-teal)" },
  disconnected: { label: "Reconnecting…", bg: "var(--band-coral)" },
  offline: { label: "Offline", bg: "var(--pill-off)" },
};

export function PageScreen({ initialTitle }: { initialTitle: string }) {
  const { pageId, status, canEdit } = usePageRoom();
  const [title, setTitle] = useState(initialTitle);
  const pill = STATUS[status] ?? STATUS.connecting;

  const commitTitle = () => {
    const next = title.trim() || "Untitled page";
    if (next !== title) setTitle(next);
    if (canEdit) void renamePageAction(pageId, next);
  };

  return (
    <div className="flex h-dvh flex-col">
      <header className="cc-noprint flex flex-none items-center gap-3 border-b-[2.5px] border-[var(--line)] bg-[var(--surface)] px-5 py-3">
        <Link
          href="/"
          className="cc-press rounded-[9px] border-2 border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-1.5 font-sans text-[12.5px] font-semibold text-[var(--ink)] shadow-[2px_2px_0_var(--shadow)]"
        >
          ← Boards &amp; pages
        </Link>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          readOnly={!canEdit}
          aria-label="Page title"
          className="min-w-0 flex-1 bg-transparent font-display text-lg font-semibold text-[var(--ink)] outline-none"
          placeholder="Untitled page"
        />
        <button
          onClick={() => window.print()}
          title="Print → Save as PDF"
          className="cc-press flex-none rounded-[8px] border-2 border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-1 font-sans text-[11px] font-semibold text-[var(--ink)] shadow-[1.5px_1.5px_0_var(--shadow)]"
        >
          PDF
        </button>
        <span
          className="flex-none rounded-full border-2 border-[var(--line)] px-2.5 py-0.5 font-sans text-[11px] font-bold text-[#1c1a17]"
          style={{ background: pill.bg }}
        >
          {pill.label}
        </span>
      </header>

      <div className="cc-dots min-h-0 flex-1 overflow-y-auto px-6 py-8">
        <div className="mx-auto max-w-[760px] rounded-2xl border-[2.5px] border-[var(--line)] bg-[var(--surface)] p-8 shadow-[4px_4px_0_var(--shadow)]">
          <PageEditor />
        </div>
      </div>
    </div>
  );
}
