/**
 * Database data access (server-only) — N4. Mirrors lib/pages.ts: a database has
 * the same owner+member+snapshot+workspace shape as a board/page; its room is
 * `db:<id>`. Sharing flows through DatabaseMember (workspace fan-out, N3-style).
 */

import "server-only";
import { getPrisma } from "@collabcanvas/db";
import { LIMITS, type Role } from "@collabcanvas/shared";

export interface DatabaseListItem {
  id: string;
  title: string;
  role: Role;
  createdAt: Date;
}

export async function listDatabasesForUser(userId: string): Promise<DatabaseListItem[]> {
  const memberships = await getPrisma().databaseMember.findMany({
    where: { userId },
    include: { database: true },
    orderBy: { database: { createdAt: "desc" } },
  });
  return memberships.map((m) => ({
    id: m.database.id,
    title: m.database.title,
    role: m.role as Role,
    createdAt: m.database.createdAt,
  }));
}

/** Create a database; the owner is auto-added as an editor member. */
export async function createDatabase(
  userId: string,
  title: string,
  workspaceId?: string,
): Promise<string> {
  const db = await getPrisma().database.create({
    data: {
      title: title.trim().slice(0, LIMITS.boardTitle) || "Untitled database",
      ownerId: userId,
      members: { create: { userId, role: "editor" } },
      ...(workspaceId ? { workspaceId } : {}),
    },
  });
  return db.id;
}

export async function getDatabaseMembership(
  databaseId: string,
  userId: string,
): Promise<Role | null> {
  const member = await getPrisma().databaseMember.findUnique({
    where: { databaseId_userId: { databaseId, userId } },
  });
  return (member?.role as Role) ?? null;
}

export async function getDatabaseTitle(databaseId: string): Promise<string | null> {
  const db = await getPrisma().database.findUnique({
    where: { id: databaseId },
    select: { title: true },
  });
  return db?.title ?? null;
}
