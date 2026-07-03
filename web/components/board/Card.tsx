"use client";

/**
 * Presentational card (design: hard-bordered white card, offset shadow, floating
 * "who's editing" chip). Renders a `CardView` and calls the callbacks it's
 * given. It uses @dnd-kit's `useSortable` for drag interaction (a UI concern)
 * but has ZERO Yjs knowledge — moves/edits are committed by the callbacks from
 * the container. Safe to restyle or replace wholesale (spec §0.1).
 */

import { useEffect, useRef, useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { CardView } from "@collabcanvas/shared";

export interface CardProps {
  card: CardView;
  columnId: string;
  canEdit: boolean;
  onUpdate: (patch: Partial<Pick<CardView, "title" | "description">>) => void;
  onDelete: () => void;
  /** Presence: who (if anyone) is currently editing this card. */
  editingBy?: { name: string; color: string } | null;
  /** Presence: called when this card's editor opens/closes. */
  onEditFocus?: () => void;
  onEditBlur?: () => void;
}

/** Stop a pointer-down on interactive controls from starting a drag. */
const stopDrag = (e: React.PointerEvent) => e.stopPropagation();

export function Card({
  card,
  columnId,
  canEdit,
  onUpdate,
  onDelete,
  editingBy,
  onEditFocus,
  onEditBlur,
}: CardProps) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(card.description);

  // If this card unmounts mid-edit (remote peer moved/deleted it), commit/cancel
  // never run — clear the presence "editing" state so peers don't see a badge
  // frozen on forever. Refs so the unmount cleanup sees current values.
  const editingRef = useRef(false);
  const onEditBlurRef = useRef(onEditBlur);
  useEffect(() => {
    onEditBlurRef.current = onEditBlur;
  });
  useEffect(
    () => () => {
      if (editingRef.current) onEditBlurRef.current?.();
    },
    [],
  );

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({
      id: card.id,
      data: { type: "card", cardId: card.id, columnId },
      disabled: !canEdit || editing,
    });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.35 : 1,
  };

  const beginEdit = () => {
    if (!canEdit) return;
    setTitle(card.title);
    setDescription(card.description);
    setEditing(true);
    editingRef.current = true;
    onEditFocus?.();
  };

  const commit = () => {
    onUpdate({ title: title.trim() || card.title, description });
    setEditing(false);
    editingRef.current = false;
    onEditBlur?.();
  };

  const cancel = () => {
    setEditing(false);
    editingRef.current = false;
    onEditBlur?.();
  };

  if (editing) {
    return (
      <div
        ref={setNodeRef}
        style={style}
        className="rounded-xl border-2 border-[var(--line)] bg-[var(--surface)] p-2 shadow-[3px_3px_0_var(--shadow)]"
      >
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") cancel();
          }}
          className="mb-1.5 w-full rounded-[7px] border-2 border-[var(--line)] bg-[var(--paper)] px-2 py-1 font-sans text-[12.5px] font-semibold text-[#1c1a17] outline-none"
          placeholder="Card title"
        />
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          className="w-full resize-none rounded-[7px] border-2 border-[var(--line)] bg-[var(--paper)] px-2 py-1 font-sans text-[11.5px] text-[#1c1a17] outline-none"
          placeholder="Description (optional)"
        />
        <div className="mt-1.5 flex items-center justify-between">
          <button
            onClick={() => {
              // Deleting while the editor is open must also clear presence.
              editingRef.current = false;
              onEditBlur?.();
              onDelete();
            }}
            className="rounded-[7px] px-2 py-1 font-sans text-[11px] font-semibold text-[var(--coral)] hover:underline"
          >
            Delete
          </button>
          <div className="flex items-center gap-1.5">
            <button
              onClick={cancel}
              className="rounded px-2 py-1 font-sans text-[11px] font-semibold text-[var(--ink-soft)]"
            >
              Cancel
            </button>
            <button
              onClick={commit}
              className="cc-press rounded-[7px] border-[1.5px] border-[var(--line)] bg-[var(--sun)] px-[11px] py-1 font-display text-[11px] font-semibold text-[#1c1a17] shadow-[1.5px_1.5px_0_var(--shadow)]"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...(canEdit ? listeners : {})}
      onDoubleClick={beginEdit}
      className={`group relative rounded-xl border-2 border-[var(--line)] bg-[var(--surface)] px-2.5 py-[9px] shadow-[3px_3px_0_var(--shadow)] ${
        canEdit ? "cursor-grab active:cursor-grabbing" : ""
      }`}
    >
      {editingBy && (
        <span
          className="absolute -top-2.5 right-[9px] z-[2] inline-flex items-center gap-1 whitespace-nowrap rounded-full border-[1.5px] border-[var(--chip-line)] px-[7px] py-0.5 font-sans text-[8.5px] font-bold text-[#1c1a17] shadow-[1.5px_1.5px_0_var(--shadow)]"
          style={{ background: editingBy.color }}
          title={`${editingBy.name} is editing`}
        >
          {editingBy.name.split(" ")[0]} ✎
        </span>
      )}
      <p className="pr-4 font-sans text-[12.5px] font-semibold leading-[1.3] text-[var(--ink)]">
        {card.title}
      </p>
      {card.description && (
        <p className="mt-1 whitespace-pre-wrap font-sans text-[11px] leading-snug text-[var(--ink-soft)]">
          {card.description}
        </p>
      )}
      {canEdit && (
        <div className="absolute right-1 top-1 hidden gap-1 group-hover:flex">
          <button
            onPointerDown={stopDrag}
            onClick={beginEdit}
            title="Edit card"
            className="flex h-5 w-5 items-center justify-center rounded-md border-[1.5px] border-[var(--line)] bg-[var(--paper)] text-[10px] text-[#1c1a17]"
          >
            ✎
          </button>
          <button
            onPointerDown={stopDrag}
            onClick={onDelete}
            title="Delete card"
            className="flex h-5 w-5 items-center justify-center rounded-md border-[1.5px] border-[var(--line)] bg-[var(--paper)] text-[10px] text-[var(--coral)]"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
