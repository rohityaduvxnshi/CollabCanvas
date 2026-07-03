"use client";

/**
 * Presentational column (design: hard-bordered panel, colored header band,
 * Space Mono count pill, ⋯ menu). Uses @dnd-kit for drag interaction only; no
 * Yjs. Column drag listeners live on the header grip (so cards inside stay
 * independently draggable). All mutations happen via the callback props.
 */

import { useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { CardView, ColumnView } from "@collabcanvas/shared";
import { Card } from "./Card";
import { AddCardInput } from "./AddCardInput";

export interface ColumnProps {
  column: ColumnView;
  /** Header band color (a CSS color; the container cycles the design palette). */
  band: string;
  canEdit: boolean;
  /** Board-wide card cap reached — the add-card affordance explains instead of no-oping. */
  atCardCap?: boolean;
  onAddCard: (title: string) => void;
  onRenameColumn: (title: string) => void;
  onDeleteColumn: () => void;
  onUpdateCard: (
    cardId: string,
    patch: Partial<Pick<CardView, "title" | "description">>,
  ) => void;
  onDeleteCard: (cardId: string) => void;
  /** Presence hooks (optional). */
  getCardEditing?: (cardId: string) => { name: string; color: string } | null;
  onCardEditFocus?: (cardId: string) => void;
  onCardEditBlur?: (cardId: string) => void;
}

export function Column({
  column,
  band,
  canEdit,
  atCardCap = false,
  onAddCard,
  onRenameColumn,
  onDeleteColumn,
  onUpdateCard,
  onDeleteCard,
  getCardEditing,
  onCardEditFocus,
  onCardEditBlur,
}: ColumnProps) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [title, setTitle] = useState(column.title);
  const [menuOpen, setMenuOpen] = useState(false);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({
      id: column.id,
      data: { type: "column", columnId: column.id },
      disabled: !canEdit,
    });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.45 : 1,
  };

  const commitTitle = () => {
    const trimmed = title.trim();
    if (trimmed && trimmed !== column.title) onRenameColumn(trimmed);
    else setTitle(column.title);
    setEditingTitle(false);
  };

  const startRename = () => {
    setMenuOpen(false);
    setTitle(column.title);
    setEditingTitle(true);
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex max-h-full w-72 shrink-0 flex-col overflow-hidden rounded-2xl border-[2.5px] border-[var(--line)] bg-[var(--surface)] shadow-[5px_5px_0_var(--shadow)]"
    >
      {/* Header band (drag handle = grip) */}
      <div
        className="relative flex flex-none items-center gap-[7px] border-b-[2.5px] border-[var(--line)] px-2.5 py-2"
        style={{ background: band }}
      >
        {canEdit && (
          <span
            {...attributes}
            {...listeners}
            title="Drag column"
            className="cursor-grab select-none text-[13px] leading-none tracking-[-2px] text-[#1c1a17] opacity-55 active:cursor-grabbing"
          >
            ⣿
          </span>
        )}

        {editingTitle ? (
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitTitle();
              if (e.key === "Escape") {
                setTitle(column.title);
                setEditingTitle(false);
              }
            }}
            className="min-w-0 flex-1 rounded-[7px] border-2 border-[var(--line)] bg-[var(--paper)] px-[7px] py-0.5 font-display text-sm font-semibold text-[#1c1a17] outline-none"
          />
        ) : (
          <h2
            onDoubleClick={() => canEdit && startRename()}
            className="m-0 min-w-0 flex-1 truncate font-display text-[14.5px] font-semibold text-[#1c1a17]"
            title={column.title}
          >
            {column.title}
          </h2>
        )}

        <span className="rounded-full border-[1.5px] border-[var(--line)] bg-[var(--paper)] px-[7px] font-mono text-[10.5px] font-bold leading-[17px] text-[#1c1a17]">
          {column.cards.length}
        </span>

        {canEdit && (
          <button
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="Column menu"
            className="flex h-[22px] w-[22px] items-center justify-center rounded-md text-[15px] leading-none text-[#1c1a17] hover:bg-[rgba(28,26,23,.12)]"
          >
            ⋯
          </button>
        )}

        {menuOpen && (
          <div
            onMouseLeave={() => setMenuOpen(false)}
            className="absolute right-2 top-[38px] z-[15] min-w-[150px] rounded-[11px] border-2 border-[var(--line)] bg-[var(--surface)] p-[5px] shadow-[4px_4px_0_var(--shadow)]"
            style={{ animation: "ccpop .12s ease" }}
          >
            <button
              onClick={startRename}
              className="block w-full rounded-[7px] px-[9px] py-[7px] text-left font-sans text-xs font-semibold text-[var(--ink)] hover:bg-[var(--surface-2)]"
            >
              Rename column
            </button>
            <button
              onClick={() => {
                setMenuOpen(false);
                onDeleteColumn();
              }}
              className="block w-full rounded-[7px] px-[9px] py-[7px] text-left font-sans text-xs font-semibold text-[var(--coral)] hover:bg-[var(--surface-2)]"
            >
              Delete column
            </button>
          </div>
        )}
      </div>

      {/* Cards */}
      <div className="flex min-h-2 flex-1 flex-col gap-[9px] overflow-y-auto p-2.5">
        <SortableContext
          items={column.cards.map((c) => c.id)}
          strategy={verticalListSortingStrategy}
        >
          {column.cards.map((card) => (
            <Card
              key={card.id}
              card={card}
              columnId={column.id}
              canEdit={canEdit}
              onUpdate={(patch) => onUpdateCard(card.id, patch)}
              onDelete={() => onDeleteCard(card.id)}
              editingBy={getCardEditing?.(card.id) ?? null}
              onEditFocus={() => onCardEditFocus?.(card.id)}
              onEditBlur={() => onCardEditBlur?.(card.id)}
            />
          ))}
        </SortableContext>

        {atCardCap ? (
          canEdit && (
            <div className="rounded-[10px] border-2 border-dashed border-[var(--line)] px-2 py-[7px] text-center font-sans text-[11px] text-[var(--ink-faint)]">
              Board is at its card limit
            </div>
          )
        ) : (
          <AddCardInput onAdd={onAddCard} canEdit={canEdit} />
        )}
      </div>
    </div>
  );
}
