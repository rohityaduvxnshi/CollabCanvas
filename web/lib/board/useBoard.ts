"use client";

/**
 * `useBoard(boardId)` — the primary UI contract hook (spec §7).
 *
 * Returns the plain `BoardData` to render, the `BoardActions` to call, the
 * connection `status`, and `canEdit`. The presentational components consume
 * only this — no Yjs, no providers, no awareness.
 */

import { useMemo, useSyncExternalStore } from "react";
import type {
  BoardActions,
  BoardData,
  ConnectionStatus,
} from "@collabcanvas/shared";
import { useBoardRoom } from "./BoardRoomProvider";
import { createBoardActions } from "../yjs/mutations";

const NO_OP: BoardActions = {
  addColumn: () => {},
  renameColumn: () => {},
  deleteColumn: () => {},
  addCard: () => {},
  updateCard: () => {},
  deleteCard: () => {},
  moveCard: () => {},
  moveColumn: () => {},
  setCardFiles: () => {},
  setColumnFiles: () => {},
};

export interface UseBoardResult {
  data: BoardData;
  actions: BoardActions;
  status: ConnectionStatus;
  canEdit: boolean;
}

export function useBoard(boardId: string): UseBoardResult {
  const room = useBoardRoom();
  const { doc, store, status, canEdit } = room;

  if (process.env.NODE_ENV !== "production" && boardId !== room.boardId) {
    console.warn(
      `useBoard("${boardId}") is rendered inside room "${room.boardId}".`,
    );
  }

  const data = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );

  const actions = useMemo<BoardActions>(
    () => (canEdit ? createBoardActions(doc) : NO_OP),
    [doc, canEdit],
  );

  return { data, actions, status, canEdit };
}
