/**
 * Board data access (server-only): list/create/share/membership. Thin Prisma
 * wrappers — API routes and server actions call these.
 */

import "server-only";
import { getPrisma } from "@collabcanvas/db";
import type { Role } from "@collabcanvas/shared";

export interface BoardListItem {
  id: string;
  title: string;
  role: Role;
  createdAt: Date;
}

export async function listBoardsForUser(userId: string): Promise<BoardListItem[]> {
  const memberships = await getPrisma().boardMember.findMany({
    where: { userId },
    include: { board: true },
    orderBy: { board: { createdAt: "desc" } },
  });
  return memberships.map((m) => ({
    id: m.board.id,
    title: m.board.title,
    role: m.role as Role,
    createdAt: m.board.createdAt,
  }));
}

/** Create a board; the owner is auto-added as an editor member (spec §4). */
export async function createBoard(userId: string, title: string): Promise<string> {
  const board = await getPrisma().board.create({
    data: {
      title: title.trim() || "Untitled board",
      ownerId: userId,
      members: { create: { userId, role: "editor" } },
    },
  });
  return board.id;
}

export async function getMembership(
  boardId: string,
  userId: string,
): Promise<Role | null> {
  const member = await getPrisma().boardMember.findUnique({
    where: { boardId_userId: { boardId, userId } },
  });
  return (member?.role as Role) ?? null;
}

export interface BoardMemberView {
  name: string;
  email: string;
  role: Role;
  isYou: boolean;
}

export async function listMembers(
  boardId: string,
  viewerUserId: string,
): Promise<BoardMemberView[]> {
  const members = await getPrisma().boardMember.findMany({
    where: { boardId },
    include: { user: true },
  });
  return members.map((m) => ({
    name: m.user.name ?? m.user.email,
    email: m.user.email,
    role: m.role as Role,
    isYou: m.userId === viewerUserId,
  }));
}

// ---------------------------------------------------------------------------
// Snapshot history (Phase 5)
// ---------------------------------------------------------------------------

export interface HistoryVersion {
  id: string;
  label: string | null;
  createdAt: Date;
}

/** Retention policy: only the newest MAX_HISTORY versions are kept (older ones
 *  are pruned on save) — so the list below is always complete, never a window. */
const MAX_HISTORY = 50;

export async function listHistory(boardId: string): Promise<HistoryVersion[]> {
  return getPrisma().boardSnapshotHistory.findMany({
    where: { boardId },
    orderBy: { createdAt: "desc" },
    take: MAX_HISTORY,
    select: { id: true, label: true, createdAt: true },
  });
}

/**
 * Save a named version by COPYING the current server snapshot (the ws-server's
 * debounced write) — the client never uploads doc bytes. Honest caveat: the
 * copy can lag live edits by a few seconds (the server debounces writes at 3s
 * idle with a 10s max-wait under sustained editing).
 */
export async function saveHistoryVersion(
  boardId: string,
  label: string | null,
): Promise<HistoryVersion | null> {
  const prisma = getPrisma();
  const snapshot = await prisma.boardSnapshot.findUnique({ where: { boardId } });
  if (!snapshot) return null; // board has never been synced/saved yet
  const created = await prisma.boardSnapshotHistory.create({
    data: { boardId, state: snapshot.state, label },
    select: { id: true, label: true, createdAt: true },
  });
  // Prune beyond the retention cap so every kept version stays listable.
  const stale = await prisma.boardSnapshotHistory.findMany({
    where: { boardId },
    orderBy: { createdAt: "desc" },
    skip: MAX_HISTORY,
    select: { id: true },
  });
  if (stale.length > 0) {
    await prisma.boardSnapshotHistory.deleteMany({
      where: { id: { in: stale.map((s) => s.id) } },
    });
  }
  return created;
}

/** Snapshot bytes for a version — used by the client-side restore transplant. */
export async function getHistoryState(
  boardId: string,
  versionId: string,
): Promise<Uint8Array | null> {
  const row = await getPrisma().boardSnapshotHistory.findUnique({
    where: { id: versionId },
  });
  if (!row || row.boardId !== boardId) return null; // no cross-board reads
  return row.state;
}

/**
 * Add (or update) a member by email. The invitee must already have signed in
 * once (a User row exists) — v1 has no email invitations, documented in the
 * share UI.
 */
export async function shareBoard(
  boardId: string,
  email: string,
  role: Role,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const prisma = getPrisma();
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return {
      ok: false,
      error: "No CollabCanvas account with that email — they need to sign in once first.",
    };
  }
  // The upsert's update branch REWRITES an existing member's role — without
  // this guard any editor could demote the owner to viewer and lock them out
  // of their own board permanently (no other role-management path exists).
  const board = await prisma.board.findUnique({
    where: { id: boardId },
    select: { ownerId: true },
  });
  if (board?.ownerId === user.id && role !== "editor") {
    return { ok: false, error: "The board owner is always an editor." };
  }
  await prisma.boardMember.upsert({
    where: { boardId_userId: { boardId, userId: user.id } },
    create: { boardId, userId: user.id, role },
    update: { role },
  });
  return { ok: true };
}
