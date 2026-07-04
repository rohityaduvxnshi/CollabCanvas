/**
 * Page data access (server-only): list/create/membership for N2 doc pages.
 * Mirrors lib/boards.ts — pages have the same owner+member+snapshot shape as
 * boards (a page's room is `page:<id>`). Sharing reuses the board pattern and
 * lands with workspaces (N3); for now a page has exactly its owner as editor.
 */

import "server-only";
import { getPrisma } from "@collabcanvas/db";
import { LIMITS, type Role } from "@collabcanvas/shared";

export interface PageListItem {
  id: string;
  title: string;
  role: Role;
  createdAt: Date;
}

export async function listPagesForUser(userId: string): Promise<PageListItem[]> {
  const memberships = await getPrisma().pageMember.findMany({
    where: { userId },
    include: { page: true },
    orderBy: { page: { createdAt: "desc" } },
  });
  return memberships.map((m) => ({
    id: m.page.id,
    title: m.page.title,
    role: m.role as Role,
    createdAt: m.page.createdAt,
  }));
}

/** Create a page; the owner is auto-added as an editor member.
 *  N3: optionally file it under a workspace. */
export async function createPage(
  userId: string,
  title: string,
  workspaceId?: string,
): Promise<string> {
  const page = await getPrisma().page.create({
    data: {
      title: title.trim().slice(0, LIMITS.boardTitle) || "Untitled page",
      ownerId: userId,
      members: { create: { userId, role: "editor" } },
      ...(workspaceId ? { workspaceId } : {}),
    },
  });
  return page.id;
}

export async function getPageMembership(
  pageId: string,
  userId: string,
): Promise<Role | null> {
  const member = await getPrisma().pageMember.findUnique({
    where: { pageId_userId: { pageId, userId } },
  });
  return (member?.role as Role) ?? null;
}

export async function getPageTitle(pageId: string): Promise<string | null> {
  const page = await getPrisma().page.findUnique({
    where: { id: pageId },
    select: { title: true },
  });
  return page?.title ?? null;
}
