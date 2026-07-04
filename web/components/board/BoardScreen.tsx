"use client";

/**
 * BoardScreen — the container that wires the `useBoard` + `usePresence` hooks
 * to the pure presentational components. It owns:
 *  - the @dnd-kit orchestration (drags commit via `actions.moveCard/moveColumn`
 *    on drop; the derived view is the single source of truth, no local drag state),
 *  - the board SCROLL container + pointer tracking, so remote cursors are
 *    positioned in board-content coordinates (correct under any scroll offset),
 *  - the editing-badge wiring (peers' `editingCardId` → per-card badge).
 *
 * This is a container, not a presentational component — it's allowed to use
 * hooks. The visual pieces it renders (Toolbar, Board, Column, Card, Cursor,
 * PresenceBar) are pure.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import type { CardView, Role } from "@collabcanvas/shared";
import { useBoard } from "@/lib/board/useBoard";
import { useBoardRoom } from "@/lib/board/BoardRoomProvider";
import { ExportButtons } from "@/components/ExportButtons";
import { boardToHtml, boardToMarkdown } from "@/lib/exporters";
import { downloadText, printHtml, safeName } from "@/lib/download";
import { usePresence } from "@/lib/board/usePresence";
import { replaceDocFromSnapshot } from "@/lib/yjs/restore";
import { shareBoardAction } from "@/lib/actions";
import { Toolbar } from "./Toolbar";
import { Board } from "./Board";
import { Cursor } from "./Cursor";
import { PresenceBar } from "./PresenceBar";
import { ShareDialog, type ShareMember } from "./ShareDialog";
import { HistoryPanel, type HistoryVersionView } from "./HistoryPanel";

type DragData =
  | { type: "card"; cardId: string; columnId: string }
  | { type: "column"; columnId: string };

type Theme = "light" | "dark";

/** Theme lives on <html data-cc-theme> so the CSS vars flip app-wide. */
function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>("light");
  useEffect(() => {
    // One-time read of an external store (localStorage isn't SSR-safe in the
    // initializer, and reading it there would hydration-mismatch). Same
    // set-state-in-effect false positive as BoardRoomProvider.
    const saved = localStorage.getItem("collabcanvas.theme");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (saved === "dark") setTheme("dark");
  }, []);
  useEffect(() => {
    document.documentElement.dataset.ccTheme = theme;
    localStorage.setItem("collabcanvas.theme", theme);
  }, [theme]);
  return [theme, () => setTheme((t) => (t === "light" ? "dark" : "light"))];
}

export interface BoardScreenProps {
  boardId: string;
  /** Membership snapshot from the server render (v1: not live-updating). */
  members?: ShareMember[];
}

export function BoardScreen({ boardId, members = [] }: BoardScreenProps) {
  const { data, actions, status, canEdit } = useBoard(boardId);
  const { doc } = useBoardRoom();
  const { peers, setCursor, clearCursor, setEditing } = usePresence();
  const [theme, toggleTheme] = useTheme();
  const [shareOpen, setShareOpen] = useState(false);

  const handleShare = (email: string, role: Role) =>
    shareBoardAction(boardId, email, role);

  // --- Version history (Phase 5) -------------------------------------------
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState(false);
  const [versions, setVersions] = useState<HistoryVersionView[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2500);
  };

  // Every history call can fail at the network level (this app works offline!)
  // — all three handlers catch everything and surface it, so the panel never
  // shows a false "no snapshots" state and nothing escapes as an unhandled
  // rejection.
  const loadHistory = async () => {
    setHistoryLoading(true);
    setHistoryError(false);
    try {
      const res = await fetch(`/api/boards/${boardId}/history`);
      if (!res.ok) throw new Error(`history: HTTP ${res.status}`);
      const body = (await res.json()) as { versions: HistoryVersionView[] };
      setVersions(body.versions);
    } catch {
      setHistoryError(true);
    } finally {
      setHistoryLoading(false);
    }
  };

  const openHistory = () => {
    setHistoryOpen(true);
    void loadHistory();
  };

  const handleSaveVersion = async (label: string): Promise<boolean> => {
    try {
      const res = await fetch(`/api/boards/${boardId}/history`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label }),
      });
      if (res.ok) {
        await loadHistory();
        showToast("Snapshot saved");
        return true;
      }
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      showToast(body?.error ?? "Couldn't save a snapshot");
      return false;
    } catch {
      showToast("Couldn't save — are you offline?");
      return false;
    }
  };

  const handleRestoreVersion = async (versionId: string): Promise<boolean> => {
    try {
      const res = await fetch(`/api/boards/${boardId}/history/${versionId}`);
      if (!res.ok) {
        showToast("Couldn't load that version");
        return false;
      }
      const body = (await res.json()) as { state: string };
      const bytes = Uint8Array.from(atob(body.state), (c) => c.charCodeAt(0));
      replaceDocFromSnapshot(doc, bytes);
      showToast("Board restored — synced to everyone");
      return true;
    } catch {
      showToast("Restore failed — are you offline?");
      return false;
    }
  };
  const [activeCard, setActiveCard] = useState<CardView | null>(null);
  const [activeColumnTitle, setActiveColumnTitle] = useState<string | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  // Last pointer position in CLIENT coords, so scrolling (which fires no
  // pointermove) can republish the cursor's true content position.
  const lastPointer = useRef<{ x: number; y: number } | null>(null);
  // Which card WE last advertised as editing — so closing editor X doesn't
  // clear a badge that has since moved to editor Y.
  const editingCardRef = useRef<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // cardId -> who is editing it (first peer wins the badge).
  const editingByCard = useMemo(() => {
    const map = new Map<string, { name: string; color: string }>();
    for (const peer of peers) {
      if (peer.editingCardId && !map.has(peer.editingCardId)) {
        map.set(peer.editingCardId, { name: peer.name, color: peer.color });
      }
    }
    return map;
  }, [peers]);

  const findCard = (cardId: string): CardView | null => {
    for (const col of data.columns) {
      const found = col.cards.find((c) => c.id === cardId);
      if (found) return found;
    }
    return null;
  };

  const clearActive = () => {
    setActiveCard(null);
    setActiveColumnTitle(null);
  };

  const handleDragStart = (event: DragStartEvent) => {
    const d = event.active.data.current as DragData | undefined;
    if (d?.type === "card") {
      setActiveCard(findCard(d.cardId));
    } else if (d?.type === "column") {
      setActiveColumnTitle(
        data.columns.find((c) => c.id === d.columnId)?.title ?? null,
      );
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    clearActive();
    const { active, over } = event;
    if (!over) return;

    const a = active.data.current as DragData | undefined;
    const o = over.data.current as DragData | undefined;
    if (!a) return;

    // --- Column reorder ---
    if (a.type === "column") {
      if (o?.type !== "column" || a.columnId === o.columnId) return;
      // dnd-kit measures droppables at their ORIGINAL (pre-drag) slots, so the
      // over item's index in the FULL list is the correct post-removal insertion
      // index — exactly arrayMove(items, from, to) semantics, which moveColumn's
      // delete-then-insert mirrors. (Using the index among the *other* columns
      // would make adjacent swaps a no-op: [A,B] drag A onto B → index 0 → A
      // re-inserted where it started.)
      const toIndex = data.columns.findIndex((c) => c.id === o.columnId);
      if (toIndex >= 0) actions.moveColumn(a.columnId, toIndex);
      return;
    }

    // --- Card move / reorder ---
    const cardId = a.cardId;
    let destColumnId: string;
    let destIndex: number;

    if (o?.type === "column") {
      // Dropped on a column body (not a specific card) → append to the end.
      // End-of-list AFTER the dragged card is removed = length without it.
      destColumnId = o.columnId;
      const destCol = data.columns.find((c) => c.id === destColumnId);
      destIndex = destCol
        ? destCol.cards.filter((c) => c.id !== cardId).length
        : 0;
    } else if (o?.type === "card") {
      // Same as columns: the over card's FULL-list index is the arrayMove `to`
      // index moveCard expects (for cross-column moves the dragged card isn't
      // in the destination list, so full-list and reduced-list agree anyway).
      destColumnId = o.columnId;
      const destCol = data.columns.find((c) => c.id === destColumnId);
      const cards = destCol ? destCol.cards : [];
      const overIndex = cards.findIndex((c) => c.id === o.cardId);
      destIndex = overIndex >= 0 ? overIndex : cards.length;
    } else {
      return;
    }

    actions.moveCard(cardId, destColumnId, destIndex);
  };

  // Report the local cursor in board-CONTENT coordinates: measuring against the
  // scrolled content element itself makes the scroll offset drop out, so every
  // peer renders the cursor against the same content-space regardless of how
  // far each of them has scrolled. setCursor is internally throttled (~20/s).
  const publishCursor = (clientX: number, clientY: number) => {
    const el = contentRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setCursor(clientX - rect.left, clientY - rect.top);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    lastPointer.current = { x: e.clientX, y: e.clientY };
    publishCursor(e.clientX, e.clientY);
  };

  const handlePointerLeave = () => {
    lastPointer.current = null;
    clearCursor();
  };

  // Scrolling moves the content under a stationary pointer without firing any
  // pointermove — republish so peers don't see the cursor pinned to a stale spot.
  const handleScroll = () => {
    const p = lastPointer.current;
    if (p) publishCursor(p.x, p.y);
  };

  const handleEditFocus = (cardId: string) => {
    editingCardRef.current = cardId;
    setEditing(cardId);
  };

  const handleEditBlur = (cardId: string) => {
    if (editingCardRef.current === cardId) {
      editingCardRef.current = null;
      setEditing(null);
    }
  };

  return (
    <div className="flex h-dvh flex-col">
      <Toolbar
        title={data.title}
        canEdit={canEdit}
        status={status}
        theme={theme}
        onToggleTheme={toggleTheme}
        right={
          <>
            <PresenceBar peers={peers} />
            <ExportButtons
              items={[
                {
                  label: "MD",
                  title: "Markdown",
                  onClick: () => downloadText(`${safeName(data.title)}.md`, boardToMarkdown(data), "text/markdown"),
                },
                {
                  label: "Word",
                  title: "HTML document — opens in Word",
                  onClick: () => downloadText(`${safeName(data.title)}.doc`, boardToHtml(data), "application/msword"),
                },
                { label: "PDF", title: "Print → Save as PDF", onClick: () => printHtml(boardToHtml(data)) },
              ]}
            />
            <button
              onClick={openHistory}
              className="cc-press rounded-[9px] border-2 border-[var(--line)] bg-[var(--surface-2)] px-3 py-1.5 font-sans text-[12.5px] font-semibold text-[var(--ink)] shadow-[2px_2px_0_var(--shadow)]"
            >
              History
            </button>
            {members.length > 0 && (
              <button
                onClick={() => setShareOpen(true)}
                className="cc-press rounded-[9px] border-2 border-[var(--line)] bg-[var(--sky)] px-3 py-1.5 font-sans text-[12.5px] font-semibold text-[#1c1a17] shadow-[2px_2px_0_var(--shadow)]"
              >
                Share
              </button>
            )}
          </>
        }
      />
      <ShareDialog
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        boardTitle={data.title}
        canInvite={canEdit}
        members={members}
        onShare={handleShare}
      />
      <HistoryPanel
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        canEdit={canEdit}
        loading={historyLoading}
        error={historyError}
        versions={versions}
        onSave={handleSaveVersion}
        onRestore={handleRestoreVersion}
      />
      {(status === "disconnected" || status === "offline") && (
        <div
          className="flex flex-none items-center gap-[9px] border-b-[2.5px] border-[var(--line)] px-[18px] py-2 font-sans text-[12.5px] font-semibold text-[#1c1a17]"
          style={{
            animation: "ccrise .25s ease",
            background: status === "offline" ? "var(--pill-off)" : "var(--hot)",
          }}
        >
          <span className="h-[9px] w-[9px] rounded-full bg-[#1c1a17]" />
          {status === "offline"
            ? "You're offline — edits save on this device and sync when you're back."
            : "Connection lost — reconnecting. Your edits keep saving locally."}
        </div>
      )}
      <div
        className="cc-dots min-h-0 flex-1 overflow-auto"
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
        onScroll={handleScroll}
      >
        <div ref={contentRef} className="relative h-full w-max min-w-full">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragCancel={clearActive}
          >
            <Board
              data={data}
              canEdit={canEdit}
              actions={actions}
              getCardEditing={(cardId) => editingByCard.get(cardId) ?? null}
              onCardEditFocus={handleEditFocus}
              onCardEditBlur={handleEditBlur}
            />
            <DragOverlay>
              {activeCard ? (
                <div className="w-64 -rotate-3 rounded-xl border-2 border-[var(--line)] bg-[var(--surface)] px-2.5 py-[9px] font-sans text-[12.5px] font-semibold leading-[1.3] text-[var(--ink)] shadow-[6px_8px_0_var(--shadow)]">
                  {activeCard.title}
                </div>
              ) : activeColumnTitle ? (
                <div className="-rotate-3 rounded-xl border-[2.5px] border-[var(--line)] bg-[var(--band-sun)] px-3 py-2 font-display text-[14.5px] font-semibold text-[#1c1a17] shadow-[6px_8px_0_var(--shadow)]">
                  {activeColumnTitle}
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>

          {/* Remote cursors — content-space overlay. overflow-hidden clips
              cursors from peers with taller/wider viewports so their translated
              boxes can't extend our scrollable area (phantom scroll space).
              Keyed by clientId: userId is NOT unique (duplicated tabs). */}
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            {peers.map((peer) =>
              peer.cursor ? (
                <Cursor
                  key={peer.clientId}
                  name={peer.name}
                  color={peer.color}
                  x={peer.cursor.x}
                  y={peer.cursor.y}
                />
              ) : null,
            )}
          </div>
        </div>
      </div>

      {/* Toast (design: green chip, bottom center) */}
      {toast && (
        <div
          className="fixed bottom-[22px] left-1/2 z-[120] -translate-x-1/2 rounded-[11px] border-[2.5px] border-[var(--line)] bg-[var(--green)] px-4 py-[9px] font-sans text-[12.5px] font-semibold text-[#1c1a17] shadow-[4px_4px_0_var(--shadow)]"
          style={{ animation: "ccrise .22s ease" }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}
