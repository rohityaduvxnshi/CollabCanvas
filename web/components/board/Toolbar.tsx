"use client";

/** Presentational: board toolbar (design: surface bar, ink underline, Fredoka
 *  title, chunky bordered buttons). Pure — state and callbacks come from the
 *  container. */

import Link from "next/link";
import type { ConnectionStatus } from "@collabcanvas/shared";
import { ConnectionPill } from "./ConnectionPill";

export interface ToolbarProps {
  title: string;
  canEdit: boolean;
  status: ConnectionStatus;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  /** Presence stack slot. */
  right?: React.ReactNode;
}

export function Toolbar({
  title,
  canEdit,
  status,
  theme,
  onToggleTheme,
  right,
}: ToolbarProps) {
  return (
    <header className="z-20 flex flex-none items-center gap-[11px] border-b-[2.5px] border-[var(--line)] bg-[var(--surface)] px-[18px] py-[11px]">
      <Link
        href="/"
        className="cc-press flex items-center gap-1 rounded-[9px] border-2 border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-[5px] font-sans text-[12.5px] font-semibold text-[var(--ink)] shadow-[2px_2px_0_var(--shadow)]"
      >
        ‹ Boards
      </Link>
      <h1 className="font-display text-[21px] font-semibold tracking-[.2px] text-[var(--ink)]">
        {title}
      </h1>
      <ConnectionPill status={status} />
      {!canEdit && (
        <span className="inline-flex items-center whitespace-nowrap rounded-full border-2 border-dashed border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-[3px] font-sans text-[11px] font-bold text-[var(--ink)]">
          View only
        </span>
      )}

      <div className="ml-auto flex items-center gap-3">
        {right}
        <button
          onClick={onToggleTheme}
          aria-label="Toggle theme"
          className="cc-press flex h-[34px] w-[34px] items-center justify-center rounded-[9px] border-2 border-[var(--line)] bg-[var(--surface-2)] text-[15px] text-[var(--ink)] shadow-[2px_2px_0_var(--shadow)]"
        >
          {theme === "light" ? "☾" : "☀"}
        </button>
      </div>
    </header>
  );
}
