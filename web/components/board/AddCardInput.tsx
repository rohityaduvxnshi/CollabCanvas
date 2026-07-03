"use client";

/** Presentational: add-a-card affordance (design: ghost text button → bordered
 *  composer with sun commit). Yjs-free. */

import { useState } from "react";

export interface AddCardInputProps {
  onAdd: (title: string) => void;
  canEdit: boolean;
}

export function AddCardInput({ onAdd, canEdit }: AddCardInputProps) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");

  if (!canEdit) return null;

  const submit = () => {
    const trimmed = title.trim();
    if (trimmed) onAdd(trimmed);
    setTitle("");
    setOpen(false);
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-[10px] border-2 border-dashed border-transparent px-2 py-[7px] text-left font-sans text-xs font-semibold text-[var(--ink-faint)] hover:border-[var(--line)] hover:bg-[var(--sunk)] hover:text-[var(--ink-soft)]"
      >
        + Add a card
      </button>
    );
  }

  return (
    <div className="rounded-xl border-2 border-[var(--line)] bg-[var(--surface)] p-2 shadow-[3px_3px_0_var(--shadow)]">
      <textarea
        autoFocus
        value={title}
        rows={2}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
          if (e.key === "Escape") {
            setTitle("");
            setOpen(false);
          }
        }}
        onBlur={submit}
        placeholder="What needs doing?"
        className="w-full resize-none bg-transparent font-sans text-[12.5px] font-semibold text-[var(--ink)] outline-none placeholder:text-[var(--ink-faint)]"
      />
      <div className="mt-[5px] flex gap-1.5">
        <button
          onMouseDown={(e) => e.preventDefault()}
          onClick={submit}
          className="cc-press rounded-[7px] border-[1.5px] border-[var(--line)] bg-[var(--sun)] px-[11px] py-1 font-display text-[11px] font-semibold text-[#1c1a17] shadow-[1.5px_1.5px_0_var(--shadow)]"
        >
          Add card
        </button>
        <button
          onClick={() => {
            setTitle("");
            setOpen(false);
          }}
          className="px-2 py-1 font-sans text-[11px] font-semibold text-[var(--ink-soft)]"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
