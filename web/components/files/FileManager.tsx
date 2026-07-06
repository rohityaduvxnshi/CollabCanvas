"use client";

/**
 * FileManager (N9) — the client half of the /files page. Lists the user's
 * uploaded files with download / rename / remove. Server renders the initial
 * list; this holds the live copy so removes/renames reflect immediately.
 * Pure presentational + fetch (no Yjs).
 */

import { useState } from "react";
import Link from "next/link";
import type { UserFile } from "@/lib/files";

const fmtSize = (n: number) =>
  n < 1024
    ? `${n} B`
    : n < 1024 * 1024
      ? `${Math.round(n / 1024)} KB`
      : `${(n / (1024 * 1024)).toFixed(1)} MB`;

function ContainerTag({ container }: { container: UserFile["container"] }) {
  if (container.kind === "board") {
    return (
      <Link href={`/boards/${container.id}`} className="underline" title="Open board">
        📋 {container.title}
      </Link>
    );
  }
  if (container.kind === "database") {
    return (
      <Link href={`/databases/${container.id}`} className="underline" title="Open database">
        🗃️ {container.title}
      </Link>
    );
  }
  return <span className="text-[var(--ink-faint)]">—</span>;
}

export function FileManager({ initial }: { initial: UserFile[] }) {
  const [files, setFiles] = useState(initial);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const remove = async (id: string) => {
    if (!confirm("Delete this file everywhere it's used? This can't be undone.")) return;
    setBusy(id);
    const res = await fetch(`/api/attachments/${id}`, { method: "DELETE" }).catch(() => null);
    setBusy(null);
    if (res && res.ok) setFiles((fs) => fs.filter((f) => f.id !== id));
  };

  const startRename = (f: UserFile) => {
    setEditing(f.id);
    setDraft(f.name);
  };

  const commitRename = async (id: string) => {
    const name = draft.trim();
    setEditing(null);
    if (!name) return;
    setBusy(id);
    const res = await fetch(`/api/attachments/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    }).catch(() => null);
    setBusy(null);
    if (res && res.ok) {
      setFiles((fs) => fs.map((f) => (f.id === id ? { ...f, name } : f)));
    }
  };

  if (files.length === 0) {
    return (
      <div className="rounded-2xl border-[2.5px] border-dashed border-[var(--line)] bg-[var(--sunk)] p-8 text-center">
        <div className="mb-1.5 font-display text-base font-semibold text-[var(--ink)]">
          No files yet
        </div>
        <div className="font-sans text-[12.5px] text-[var(--ink-soft)]">
          Attach files to a board card, column, or database row — they show up here.
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border-[2.5px] border-[var(--line)] bg-[var(--surface)] shadow-[4px_4px_0_var(--shadow)]">
      <table className="w-full border-collapse text-left font-sans text-[12.5px]">
        <thead>
          <tr className="border-b-[2.5px] border-[var(--line)] bg-[var(--surface-2)] font-display text-[12px] font-semibold text-[var(--ink)]">
            <th className="px-3.5 py-2.5">Name</th>
            <th className="px-3.5 py-2.5">Size</th>
            <th className="px-3.5 py-2.5">Used in</th>
            <th className="px-3.5 py-2.5 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {files.map((f) => (
            <tr key={f.id} className="border-b-2 border-[var(--line)] last:border-b-0">
              <td className="max-w-[280px] px-3.5 py-2.5 font-semibold text-[var(--ink)]">
                {editing === f.id ? (
                  <input
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={() => commitRename(f.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRename(f.id);
                      if (e.key === "Escape") setEditing(null);
                    }}
                    className="w-full rounded-[7px] border-2 border-[var(--line)] bg-[var(--paper)] px-2 py-1 outline-none"
                  />
                ) : (
                  <span className="block truncate" title={f.name}>
                    📎 {f.name}
                  </span>
                )}
              </td>
              <td className="whitespace-nowrap px-3.5 py-2.5 font-mono text-[11px] text-[var(--ink-soft)]">
                {fmtSize(f.size)}
              </td>
              <td className="max-w-[200px] truncate px-3.5 py-2.5 text-[var(--ink-soft)]">
                <ContainerTag container={f.container} />
              </td>
              <td className="whitespace-nowrap px-3.5 py-2.5 text-right">
                <a
                  href={`/api/attachments/${f.id}`}
                  className="mr-2 font-semibold text-[var(--ink)] underline"
                >
                  Download
                </a>
                <button
                  onClick={() => startRename(f)}
                  disabled={busy === f.id}
                  className="mr-2 font-semibold text-[var(--ink-soft)] hover:underline disabled:opacity-50"
                >
                  Rename
                </button>
                <button
                  onClick={() => remove(f.id)}
                  disabled={busy === f.id}
                  className="font-semibold text-[var(--coral)] hover:underline disabled:opacity-50"
                >
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
