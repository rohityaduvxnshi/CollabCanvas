"use client";

/**
 * FileAttachments (N9) — attach/list/download/remove files on a board card or
 * column. Presentational + fetch (no Yjs, same contract as db/AttachmentCell):
 * it uploads to /api/boards/:boardId/attachments, renders download chips, and
 * commits the new FileRef[] via `onChange` (the parent calls setCardFiles /
 * setColumnFiles). Supports click-to-pick AND drag-and-drop.
 */

import { useRef, useState } from "react";
import { LIMITS, type FileRef } from "@collabcanvas/shared";

const fmtSize = (n: number) =>
  n < 1024
    ? `${n} B`
    : n < 1024 * 1024
      ? `${Math.round(n / 1024)} KB`
      : `${(n / (1024 * 1024)).toFixed(1)} MB`;

export function FileAttachments({
  boardId,
  files,
  canEdit,
  onChange,
  label = "Attach files",
}: {
  boardId: string;
  files: FileRef[];
  canEdit: boolean;
  onChange: (next: FileRef[]) => void;
  label?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const uploadOne = async (file: File): Promise<FileRef | null> => {
    const body = new FormData();
    body.append("file", file);
    const res = await fetch(`/api/boards/${boardId}/attachments`, { method: "POST", body });
    const json = (await res.json().catch(() => null)) as
      | { attachment?: FileRef; error?: string }
      | null;
    if (!res.ok || !json?.attachment) {
      setError(json?.error ?? "Upload failed.");
      return null;
    }
    return json.attachment;
  };

  const addFiles = async (picked: FileList | File[]) => {
    if (!canEdit) return;
    setError(null);
    const list = Array.from(picked);
    if (!list.length) return;
    if (files.length + list.length > LIMITS.attachmentsPerCell) {
      setError(`Up to ${LIMITS.attachmentsPerCell} files here.`);
      return;
    }
    setBusy(true);
    try {
      const added: FileRef[] = [];
      for (const f of list) {
        const ref = await uploadOne(f);
        if (ref) added.push(ref);
      }
      if (added.length) onChange([...files, ...added]);
    } catch {
      setError("Upload failed — check your connection.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const remove = async (id: string) => {
    onChange(files.filter((f) => f.id !== id)); // optimistic (detach from the doc)
    await fetch(`/api/attachments/${id}`, { method: "DELETE" }).catch(() => {});
  };

  return (
    <div
      onDragOver={
        canEdit
          ? (e) => {
              e.preventDefault();
              setDragOver(true);
            }
          : undefined
      }
      onDragLeave={() => setDragOver(false)}
      onDrop={
        canEdit
          ? (e) => {
              e.preventDefault();
              setDragOver(false);
              if (e.dataTransfer.files.length) void addFiles(e.dataTransfer.files);
            }
          : undefined
      }
      className={`flex flex-col gap-1 rounded-[9px] ${
        dragOver ? "outline outline-2 outline-dashed outline-[var(--line)]" : ""
      }`}
    >
      {files.map((f) => (
        <div key={f.id} className="flex items-center gap-1.5">
          <a
            href={`/api/attachments/${f.id}`}
            className="min-w-0 flex-1 truncate font-sans text-[11.5px] font-semibold text-[var(--ink)] underline"
            title={`${f.name} (${fmtSize(f.size)}) — download`}
          >
            📎 {f.name}
          </a>
          <span className="flex-none font-mono text-[9px] text-[var(--ink-faint)]">
            {fmtSize(f.size)}
          </span>
          {canEdit ? (
            <button
              type="button"
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
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            className="rounded-[8px] border-2 border-dashed border-[var(--line)] px-2 py-1 font-sans text-[11px] font-semibold text-[var(--ink-soft)] hover:bg-[var(--sunk)] disabled:opacity-60"
          >
            {busy ? "Uploading…" : `📎 ${label} — or drop here`}
          </button>
          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) void addFiles(e.target.files);
            }}
          />
        </div>
      ) : files.length === 0 ? (
        <span className="font-sans text-[10.5px] text-[var(--ink-faint)]">No files</span>
      ) : null}

      {error ? (
        <div className="font-sans text-[10px] font-semibold text-[var(--coral)]">{error}</div>
      ) : null}
    </div>
  );
}
