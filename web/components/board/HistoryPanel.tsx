"use client";

/**
 * Presentational: version-history slide-in panel (design mock: right drawer,
 * band-violet header, save row, version rows with inline restore confirm).
 * Pure — fetching/restoring happens in the container via the callbacks.
 */

import { useState } from "react";

export interface HistoryVersionView {
  id: string;
  label: string | null;
  createdAt: string; // ISO
}

export interface HistoryPanelProps {
  open: boolean;
  onClose: () => void;
  canEdit: boolean;
  loading: boolean;
  /** Loading the list failed (offline / server error) — distinct from empty. */
  error?: boolean;
  versions: HistoryVersionView[];
  onSave: (label: string) => Promise<boolean>;
  onRestore: (versionId: string) => Promise<boolean>;
}

function relTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.round(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleDateString();
}

export function HistoryPanel({
  open,
  onClose,
  canEdit,
  loading,
  error = false,
  versions,
  onSave,
  onRestore,
}: HistoryPanelProps) {
  const [saveLabel, setSaveLabel] = useState("");
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  const save = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (await onSave(saveLabel.trim())) setSaveLabel("");
    } finally {
      setBusy(false);
    }
  };

  const restore = async (id: string) => {
    if (busy) return;
    setBusy(true);
    try {
      if (await onRestore(id)) {
        setConfirmingId(null);
        onClose();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div onClick={onClose} className="fixed inset-0 z-[100] bg-[rgba(22,17,8,.35)]">
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Version history"
        className="absolute bottom-0 right-0 top-0 flex w-[340px] max-w-[88vw] flex-col border-l-[2.5px] border-[var(--line)] bg-[var(--surface)] shadow-[-8px_0_24px_rgba(15,10,2,.28)]"
        style={{ animation: "ccrise .22s ease" }}
      >
        {/* Header */}
        <div className="flex flex-none items-center gap-2 border-b-[2.5px] border-[var(--line)] bg-[var(--band-violet)] px-3.5 py-[11px]">
          <div className="font-display text-[15.5px] font-semibold text-[#1c1a17]">History</div>
          <div className="font-sans text-[11px] text-[#1c1a17] opacity-75">
            snapshots of this board
          </div>
          <button
            onClick={onClose}
            aria-label="Close history"
            className="ml-auto flex h-6 w-6 flex-none items-center justify-center rounded-[7px] border-[1.5px] border-[var(--line)] bg-[var(--paper)] text-xs text-[#1c1a17]"
          >
            ✕
          </button>
        </div>

        {/* Save row / viewer note */}
        {canEdit ? (
          <div className="flex flex-none gap-1.5 border-b-[2.5px] border-[var(--line)] bg-[var(--surface-2)] px-3.5 py-3">
            <input
              value={saveLabel}
              onChange={(e) => setSaveLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void save();
              }}
              placeholder="Label this snapshot…"
              aria-label="Snapshot label"
              className="min-w-0 flex-1 rounded-[9px] border-2 border-[var(--line)] bg-[var(--surface)] px-2.5 py-[7px] font-sans text-xs font-semibold text-[var(--ink)] outline-none"
            />
            <button
              onClick={() => void save()}
              disabled={busy}
              className="cc-press flex-none rounded-[9px] border-2 border-[var(--line)] bg-[var(--sun)] px-3 py-[7px] font-display text-xs font-semibold text-[#1c1a17] shadow-[2px_2px_0_var(--shadow)] disabled:opacity-60"
            >
              Save
            </button>
          </div>
        ) : (
          <div className="flex-none border-b-[2.5px] border-[var(--line)] bg-[var(--surface-2)] px-3.5 py-2.5 font-sans text-[11.5px] text-[var(--ink-soft)]">
            View only — ask an editor to save or restore snapshots.
          </div>
        )}

        {/* Versions */}
        <div className="flex min-h-0 flex-1 flex-col gap-[9px] overflow-y-auto px-3.5 py-[13px]">
          {loading && versions.length === 0 && (
            <div className="py-6 text-center font-sans text-[11.5px] text-[var(--ink-faint)]">
              Loading…
            </div>
          )}
          {!loading && error && (
            <div className="rounded-[11px] border-[1.5px] border-dashed border-[var(--coral)] bg-[rgba(255,107,94,.1)] px-3.5 py-5 text-center font-sans text-[11.5px] text-[var(--ink-soft)]">
              Couldn&apos;t load history — you may be offline.
              <br />
              Close and reopen to retry.
            </div>
          )}
          {!loading && !error && versions.length === 0 && (
            <div className="rounded-[11px] border-2 border-dashed border-[var(--line)] px-3.5 py-5 text-center font-sans text-[11.5px] text-[var(--ink-faint)]">
              No snapshots yet.
              <br />
              Save one before big changes.
            </div>
          )}
          {versions.map((v) => (
            <div
              key={v.id}
              className="rounded-[11px] border-2 border-[var(--line)] px-[11px] py-[9px] shadow-[2px_2px_0_var(--shadow)]"
            >
              <div className="flex items-center gap-[7px]">
                <span className="h-2 w-2 flex-none rounded-full border-[1.5px] border-[var(--chip-line)] bg-[var(--violet)]" />
                <span className="min-w-0 flex-1 truncate font-sans text-xs font-semibold text-[var(--ink)]">
                  {v.label || "Unlabeled snapshot"}
                </span>
                <span className="flex-none font-mono text-[9.5px] text-[var(--ink-faint)]">
                  {relTime(v.createdAt)}
                </span>
              </div>
              {canEdit &&
                (confirmingId === v.id ? (
                  <div className="mt-2 rounded-[9px] border-[1.5px] border-dashed border-[var(--coral)] bg-[rgba(255,107,94,.12)] px-[9px] py-2">
                    <div className="mb-[7px] font-sans text-[11px] font-semibold text-[var(--ink)]">
                      Replace the live board for everyone?
                    </div>
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => void restore(v.id)}
                        disabled={busy}
                        className="cc-press rounded-[7px] border-[1.5px] border-[var(--line)] bg-[var(--coral)] px-[11px] py-1 font-display text-[11px] font-semibold text-white shadow-[1.5px_1.5px_0_var(--shadow)] disabled:opacity-60"
                      >
                        Restore
                      </button>
                      <button
                        onClick={() => setConfirmingId(null)}
                        className="px-2 py-1 font-sans text-[11px] font-semibold text-[var(--ink-soft)]"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmingId(v.id)}
                    className="cc-press mt-2 rounded-[7px] border-[1.5px] border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-[3px] font-sans text-[10.5px] font-semibold text-[var(--ink)] shadow-[1.5px_1.5px_0_var(--shadow)]"
                  >
                    ↺ Restore
                  </button>
                ))}
            </div>
          ))}
          <div className="mt-1 font-mono text-[9.5px] text-[var(--ink-faint)]">
            Snapshots capture the whole board. Restoring syncs to everyone.
          </div>
        </div>
      </div>
    </div>
  );
}
