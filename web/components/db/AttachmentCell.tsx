"use client";

/**
 * AttachmentCell (N5) — the editor for an attachment-type database cell. The
 * cell value is a JSON array of {id,name,size}; this component uploads files to
 * the database's attachments API, renders download chips, and removes files.
 * No Yjs (the parent commits the new JSON via setCell) — it does do fetch,
 * which the pure-component contract allows.
 */

import { useRef, useState } from "react";
import { LIMITS } from "@collabcanvas/shared";

interface FileRef {
  id: string;
  name: string;
  size: number;
}

function parse(value: string | number | boolean | undefined): FileRef[] {
  if (typeof value !== "string" || !value) return [];
  try {
    const arr = JSON.parse(value);
    return Array.isArray(arr) ? arr.filter((f) => f && typeof f.id === "string") : [];
  } catch {
    return [];
  }
}

const fmtSize = (n: number) =>
  n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / (1024 * 1024)).toFixed(1)} MB`;

export function AttachmentCell({
  databaseId,
  value,
  canEdit,
  onChange,
}: {
  databaseId: string;
  value: string | number | boolean | undefined;
  canEdit: boolean;
  onChange: (next: string | null) => void;
}) {
  const files = parse(value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const commit = (next: FileRef[]) => onChange(next.length ? JSON.stringify(next) : null);

  const upload = async (file: File) => {
    setError(null);
    if (files.length >= LIMITS.attachmentsPerCell) {
      setError(`Up to ${LIMITS.attachmentsPerCell} files per cell.`);
      return;
    }
    setBusy(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch(`/api/databases/${databaseId}/attachments`, {
        method: "POST",
        body,
      });
      const json = (await res.json()) as { attachment?: FileRef; error?: string };
      if (!res.ok || !json.attachment) {
        setError(json.error ?? "Upload failed.");
      } else {
        commit([...files, json.attachment]);
      }
    } catch {
      setError("Upload failed — check your connection.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const remove = async (id: string) => {
    commit(files.filter((f) => f.id !== id)); // optimistic
    await fetch(`/api/attachments/${id}`, { method: "DELETE" }).catch(() => {});
  };

  return (
    <div className="flex flex-col gap-1 px-2 py-1.5">
      {files.map((f) => (
        <div key={f.id} className="flex items-center gap-1.5">
          <a
            href={`/api/attachments/${f.id}`}
            className="min-w-0 flex-1 truncate font-sans text-[11.5px] font-semibold text-[var(--ink)] underline"
            title={`${f.name} (${fmtSize(f.size)})`}
          >
            📎 {f.name}
          </a>
          <span className="flex-none font-mono text-[9px] text-[var(--ink-faint)]">
            {fmtSize(f.size)}
          </span>
          {canEdit ? (
            <button
              onClick={() => remove(f.id)}
              title="Remove file"
              className="flex-none font-sans text-[11px] font-semibold text-[var(--coral)]"
            >
              ✕
            </button>
          ) : null}
        </div>
      ))}
      {canEdit ? (
        <div>
          <input
            ref={inputRef}
            type="file"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
            }}
            className="max-w-[160px] text-[10.5px] text-[var(--ink-soft)]"
          />
          {busy ? (
            <span className="ml-1 font-sans text-[10px] text-[var(--ink-faint)]">uploading…</span>
          ) : null}
          {error ? (
            <div className="mt-0.5 font-sans text-[10px] font-semibold text-[var(--coral)]">
              {error}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
