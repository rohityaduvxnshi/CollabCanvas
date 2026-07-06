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
  const [pickerOpen, setPickerOpen] = useState(false);
  const [myFiles, setMyFiles] = useState<FileRef[] | null>(null);
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

  // DETACH only — remove the chip from THIS card/column. We must NOT delete the
  // file globally: the same file can be reused on other cards/columns/db-cells
  // (the Reuse picker + /files), so a global delete here would 404 every other
  // reference and wrongly free quota. Actual deletion (bytes + row) lives in the
  // /files manager, which confirms "delete everywhere". (Review N9.)
  const remove = (id: string) => {
    onChange(files.filter((f) => f.id !== id));
  };

  // Reuse: attach an already-uploaded file (no re-upload). Only your own files.
  const togglePicker = async () => {
    if (pickerOpen) {
      setPickerOpen(false);
      return;
    }
    setError(null);
    setMyFiles(null);
    setPickerOpen(true);
    try {
      const res = await fetch("/api/files");
      const json = (await res.json().catch(() => null)) as { files?: FileRef[] } | null;
      setMyFiles(json?.files ?? []);
    } catch {
      setMyFiles([]);
    }
  };

  const attachExisting = (f: FileRef) => {
    if (files.some((x) => x.id === f.id)) return;
    if (files.length >= LIMITS.attachmentsPerCell) {
      setError(`Up to ${LIMITS.attachmentsPerCell} files here.`);
      return;
    }
    onChange([...files, f]);
    setPickerOpen(false);
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
              // Ignore a drop while an upload is in flight — addFiles closes over
              // the current `files`, so a concurrent add would commit a stale
              // list and clobber the in-flight one (review N9).
              if (busy) return;
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
              title="Remove from here (the file stays in your Files)"
              className="flex-none font-sans text-[11px] font-semibold text-[var(--coral)]"
            >
              ✕
            </button>
          ) : null}
        </div>
      ))}

      {canEdit ? (
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
              className="rounded-[8px] border-2 border-dashed border-[var(--line)] px-2 py-1 font-sans text-[11px] font-semibold text-[var(--ink-soft)] hover:bg-[var(--sunk)] disabled:opacity-60"
            >
              {busy ? "Uploading…" : `📎 ${label} — or drop here`}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={togglePicker}
              className="rounded-[8px] border-2 border-[var(--line)] px-2 py-1 font-sans text-[11px] font-semibold text-[var(--ink-soft)] hover:bg-[var(--sunk)] disabled:opacity-60"
            >
              ↻ Reuse
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
          {pickerOpen ? (
            <div className="max-h-40 overflow-y-auto rounded-[9px] border-2 border-[var(--line)] bg-[var(--surface-2)] p-1">
              {myFiles === null ? (
                <span className="block px-1 py-0.5 font-sans text-[10.5px] text-[var(--ink-faint)]">
                  Loading your files…
                </span>
              ) : myFiles.filter((f) => !files.some((x) => x.id === f.id)).length === 0 ? (
                <span className="block px-1 py-0.5 font-sans text-[10.5px] text-[var(--ink-faint)]">
                  No other files to reuse.
                </span>
              ) : (
                myFiles
                  .filter((f) => !files.some((x) => x.id === f.id))
                  .map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => attachExisting(f)}
                      className="block w-full truncate rounded-[6px] px-1.5 py-1 text-left font-sans text-[11px] font-semibold text-[var(--ink)] hover:bg-[var(--surface)]"
                      title={`Attach ${f.name}`}
                    >
                      📎 {f.name}{" "}
                      <span className="font-mono text-[9px] text-[var(--ink-faint)]">
                        {fmtSize(f.size)}
                      </span>
                    </button>
                  ))
              )}
            </div>
          ) : null}
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
