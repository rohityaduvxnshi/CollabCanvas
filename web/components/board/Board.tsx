"use client";

/**
 * Presentational board: a horizontal, sortable row of columns, plus the empty
 * state and the trailing "+ Add column" affordance (design: dashed panel →
 * bordered composer). Pure — receives `BoardData` + `BoardActions` and renders.
 * No Yjs.
 */

import { useState } from "react";
import {
  SortableContext,
  horizontalListSortingStrategy,
} from "@dnd-kit/sortable";
import { LIMITS, type BoardActions, type BoardData } from "@collabcanvas/shared";
import { Column } from "./Column";

/** Design palette: column header bands cycle through these. */
const BANDS = [
  "var(--band-violet)",
  "var(--band-coral)",
  "var(--band-teal)",
  "var(--band-sun)",
  "var(--band-sky)",
  "var(--band-pink)",
];

export interface BoardProps {
  data: BoardData;
  canEdit: boolean;
  actions: BoardActions;
  /** Presence hooks (optional). */
  getCardEditing?: (cardId: string) => { name: string; color: string } | null;
  onCardEditFocus?: (cardId: string) => void;
  onCardEditBlur?: (cardId: string) => void;
}

function AddColumn({
  onAdd,
  atCap,
}: {
  onAdd: (title: string) => void;
  atCap: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");

  const submit = () => {
    const trimmed = title.trim();
    if (trimmed) onAdd(trimmed);
    setTitle("");
    setOpen(false);
  };

  // At the cap the mutation would silently no-op — say so instead of eating
  // the user's typed title (Phase 6 review).
  if (atCap) {
    return (
      <div className="w-72 shrink-0 rounded-2xl border-[2.5px] border-dashed border-[var(--line)] bg-[var(--sunk)] p-3.5 text-center font-sans text-xs text-[var(--ink-faint)]">
        Board is at its {LIMITS.columnsPerBoard}-column limit
      </div>
    );
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-72 shrink-0 rounded-2xl border-[2.5px] border-dashed border-[var(--line)] bg-[var(--sunk)] p-3.5 font-display text-[13px] font-semibold text-[var(--ink-soft)] hover:bg-[var(--surface-2)]"
      >
        + Add column
      </button>
    );
  }

  return (
    <div className="w-72 shrink-0 rounded-2xl border-[2.5px] border-[var(--line)] bg-[var(--surface)] p-[11px] shadow-[5px_5px_0_var(--shadow)]">
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
          if (e.key === "Escape") {
            setTitle("");
            setOpen(false);
          }
        }}
        onBlur={() => {
          setTitle("");
          setOpen(false);
        }}
        placeholder="Column name…"
        className="w-full rounded-lg border-2 border-[var(--line)] bg-transparent px-[9px] py-[5px] font-display text-sm font-semibold text-[var(--ink)] outline-none placeholder:text-[var(--ink-faint)]"
      />
      <div className="mt-2 flex gap-1.5">
        <button
          onMouseDown={(e) => e.preventDefault()}
          onClick={submit}
          className="cc-press rounded-lg border-2 border-[var(--line)] bg-[var(--sun)] px-[13px] py-[5px] font-display text-xs font-semibold text-[#1c1a17] shadow-[2px_2px_0_var(--shadow)]"
        >
          Add
        </button>
        <button
          onClick={() => {
            setTitle("");
            setOpen(false);
          }}
          className="px-2 py-[5px] font-sans text-xs font-semibold text-[var(--ink-soft)]"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function EmptyState({
  canEdit,
  onAdd,
}: {
  canEdit: boolean;
  onAdd: (title: string) => void;
}) {
  return (
    <div className="m-auto max-w-[420px] text-center" style={{ animation: "ccpop .3s ease" }}>
      <div className="relative mx-auto mb-5 h-[78px] w-[110px]">
        <div className="absolute left-0 top-2 h-[62px] w-[30px] -rotate-[5deg] rounded-lg border-[2.5px] border-[var(--line)] bg-[var(--band-coral)] shadow-[3px_3px_0_var(--shadow)]" />
        <div className="absolute left-10 top-0 h-[70px] w-[30px] rounded-lg border-[2.5px] border-[var(--line)] bg-[var(--band-teal)] shadow-[3px_3px_0_var(--shadow)]" />
        <div className="absolute left-20 top-2 h-[62px] w-[30px] rotate-[5deg] rounded-lg border-[2.5px] border-[var(--line)] bg-[var(--band-violet)] shadow-[3px_3px_0_var(--shadow)]" />
      </div>
      <div className="mb-[7px] font-display text-[22px] font-semibold text-[var(--ink)]">
        This board is a blank canvas
      </div>
      <div className="mb-5 font-sans text-[13.5px] leading-normal text-[var(--ink-soft)]">
        Add your first column to start organizing. Everything you do here syncs
        live with your team.
      </div>
      {canEdit && (
        <button
          onClick={() => onAdd("To do")}
          className="cc-press rounded-[11px] border-[2.5px] border-[var(--line)] bg-[var(--sun)] px-5 py-2.5 font-display text-sm font-semibold text-[#1c1a17] shadow-[3px_3px_0_var(--shadow)]"
        >
          + Add your first column
        </button>
      )}
    </div>
  );
}

export function Board({
  data,
  canEdit,
  actions,
  getCardEditing,
  onCardEditFocus,
  onCardEditBlur,
}: BoardProps) {
  // Note: the SCROLL container lives in BoardScreen (so the live-cursor layer
  // can share the board-content coordinate space); this row just sizes to its
  // columns (`w-max`) while stretching to at least the viewport (`min-w-full`).
  const totalCards = data.columns.reduce((n, c) => n + c.cards.length, 0);
  const atCardCap = totalCards >= LIMITS.cardsPerBoard;

  return (
    <div className="flex h-full w-max min-w-full items-start gap-4 p-[18px]">
      {data.columns.length === 0 ? (
        <EmptyState canEdit={canEdit} onAdd={actions.addColumn} />
      ) : (
        <>
          <SortableContext
            items={data.columns.map((c) => c.id)}
            strategy={horizontalListSortingStrategy}
          >
            {data.columns.map((column, i) => (
              <Column
                key={column.id}
                column={column}
                band={BANDS[i % BANDS.length]}
                canEdit={canEdit}
                atCardCap={atCardCap}
                onAddCard={(title) => actions.addCard(column.id, title)}
                onRenameColumn={(title) => actions.renameColumn(column.id, title)}
                onDeleteColumn={() => actions.deleteColumn(column.id)}
                onUpdateCard={actions.updateCard}
                onDeleteCard={actions.deleteCard}
                getCardEditing={getCardEditing}
                onCardEditFocus={onCardEditFocus}
                onCardEditBlur={onCardEditBlur}
              />
            ))}
          </SortableContext>
          {canEdit && (
            <AddColumn
              onAdd={actions.addColumn}
              atCap={data.columns.length >= LIMITS.columnsPerBoard}
            />
          )}
        </>
      )}
    </div>
  );
}
