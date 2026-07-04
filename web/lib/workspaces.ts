/**
 * Workspace data access (server-only) — N3.
 *
 * Workspaces ORGANIZE boards/pages; they do NOT change socket auth. Access is
 * still per Board/PageMember. Sharing a team workspace fans out membership rows
 * into those existing tables (createBoard/createPage add the workspace's members
 * too), so getMembership and the ws-token routes are untouched.
 *
 * A user's Private workspace is auto-created on first access. Pre-N3 boards/pages
 * (workspaceId = null) are treated as belonging to the owner's Private space.
 */

// No "server-only" here (same as emailAuth.ts) so the phase-n3 harness can
// exercise the real functions; getPrisma would fail in a client bundle anyway,
// and no client component imports this module.
import { getPrisma } from "@collabcanvas/db";
import { LIMITS, type Role } from "@collabcanvas/shared";

export interface WorkspaceView {
  id: string;
  name: string;
  type: "private" | "team";
  isOwner: boolean;
}

/** Get-or-create the user's single Private workspace. */
export async function ensurePrivateWorkspace(userId: string): Promise<string> {
  const prisma = getPrisma();
  const existing = await prisma.workspace.findFirst({
    where: { ownerId: userId, type: "private" },
    select: { id: true },
  });
  if (existing) return existing.id;
  const created = await prisma.workspace.create({
    data: { name: "Private", type: "private", ownerId: userId },
    select: { id: true },
  });
  return created.id;
}

/** All workspaces the user can see: their Private + team spaces they belong to. */
export async function listWorkspacesForUser(userId: string): Promise<WorkspaceView[]> {
  const prisma = getPrisma();
  await ensurePrivateWorkspace(userId);
  const rows = await prisma.workspace.findMany({
    where: {
      OR: [{ ownerId: userId }, { members: { some: { userId } } }],
    },
    orderBy: [{ type: "asc" }, { createdAt: "asc" }],
  });
  return rows.map((w) => ({
    id: w.id,
    name: w.name,
    type: w.type as "private" | "team",
    isOwner: w.ownerId === userId,
  }));
}

export async function createTeamWorkspace(userId: string, name: string): Promise<string> {
  const ws = await getPrisma().workspace.create({
    data: {
      name: name.trim().slice(0, LIMITS.boardTitle) || "Team workspace",
      type: "team",
      ownerId: userId,
      members: { create: { userId, role: "editor" } },
    },
    select: { id: true },
  });
  return ws.id;
}

/** Role in a workspace: owner ("editor") or explicit member, else null. */
export async function getWorkspaceMembership(
  workspaceId: string,
  userId: string,
): Promise<Role | null> {
  const prisma = getPrisma();
  const ws = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { ownerId: true },
  });
  if (!ws) return null;
  if (ws.ownerId === userId) return "editor";
  const m = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
  });
  return (m?.role as Role) ?? null;
}

/** Ids of every member of a workspace (owner + explicit members). */
export async function workspaceMemberIds(workspaceId: string): Promise<
  { userId: string; role: Role }[]
> {
  const prisma = getPrisma();
  const ws = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { ownerId: true, members: { select: { userId: true, role: true } } },
  });
  if (!ws) return [];
  const out = new Map<string, Role>();
  out.set(ws.ownerId, "editor");
  for (const m of ws.members) if (!out.has(m.userId)) out.set(m.userId, m.role as Role);
  return Array.from(out, ([userId, role]) => ({ userId, role }));
}

/** Give every member of a workspace access to a newly-created board (upsert =
 *  idempotent; the owner is already a member). No-op for a private workspace. */
export async function addWorkspaceMembersToBoard(
  workspaceId: string,
  boardId: string,
): Promise<void> {
  const prisma = getPrisma();
  const members = await workspaceMemberIds(workspaceId);
  if (members.length <= 1) return;
  await prisma.$transaction(
    members.map((m) =>
      prisma.boardMember.upsert({
        where: { boardId_userId: { boardId, userId: m.userId } },
        create: { boardId, userId: m.userId, role: m.role },
        update: {},
      }),
    ),
  );
}

/** Same for a page. */
export async function addWorkspaceMembersToPage(
  workspaceId: string,
  pageId: string,
): Promise<void> {
  const prisma = getPrisma();
  const members = await workspaceMemberIds(workspaceId);
  if (members.length <= 1) return;
  await prisma.$transaction(
    members.map((m) =>
      prisma.pageMember.upsert({
        where: { pageId_userId: { pageId, userId: m.userId } },
        create: { pageId, userId: m.userId, role: m.role },
        update: {},
      }),
    ),
  );
}

/** Same for a database (N4). */
export async function addWorkspaceMembersToDatabase(
  workspaceId: string,
  databaseId: string,
): Promise<void> {
  const prisma = getPrisma();
  const members = await workspaceMemberIds(workspaceId);
  if (members.length <= 1) return;
  await prisma.$transaction(
    members.map((m) =>
      prisma.databaseMember.upsert({
        where: { databaseId_userId: { databaseId, userId: m.userId } },
        create: { databaseId, userId: m.userId, role: m.role },
        update: {},
      }),
    ),
  );
}

type WsItem = { id: string; title: string; role: Role; createdAt: Date };

export interface WorkspaceContents {
  boards: WsItem[];
  pages: WsItem[];
  databases: WsItem[];
}

/**
 * Boards + pages + databases in a workspace that the user has access to (per
 * Board/Page/DatabaseMember). For the Private workspace, pre-N3 rows
 * (workspaceId=null) owned by the user are included.
 */
export async function workspaceContents(
  workspaceId: string,
  userId: string,
  isPrivate: boolean,
): Promise<WorkspaceContents> {
  const prisma = getPrisma();
  const where = isPrivate
    ? { OR: [{ workspaceId }, { workspaceId: null, ownerId: userId }] }
    : { workspaceId };

  const [boardMembers, pageMembers, dbMembers] = await Promise.all([
    prisma.boardMember.findMany({
      where: { userId, board: where },
      include: { board: true },
      orderBy: { board: { createdAt: "desc" } },
    }),
    prisma.pageMember.findMany({
      where: { userId, page: where },
      include: { page: true },
      orderBy: { page: { createdAt: "desc" } },
    }),
    prisma.databaseMember.findMany({
      where: { userId, database: where },
      include: { database: true },
      orderBy: { database: { createdAt: "desc" } },
    }),
  ]);

  return {
    boards: boardMembers.map((m) => ({
      id: m.board.id,
      title: m.board.title,
      role: m.role as Role,
      createdAt: m.board.createdAt,
    })),
    pages: pageMembers.map((m) => ({
      id: m.page.id,
      title: m.page.title,
      role: m.role as Role,
      createdAt: m.page.createdAt,
    })),
    databases: dbMembers.map((m) => ({
      id: m.database.id,
      title: m.database.title,
      role: m.role as Role,
      createdAt: m.database.createdAt,
    })),
  };
}

/**
 * Share a team workspace with a user (must already have an account). Adds the
 * workspace member AND fans out Board/PageMember rows for every board/page
 * currently in the workspace — so socket access flows through the existing,
 * reviewed membership path with no auth-model change.
 */
export async function shareWorkspace(
  workspaceId: string,
  email: string,
  role: Role,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const prisma = getPrisma();
  const ws = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { type: true, ownerId: true },
  });
  if (!ws) return { ok: false, error: "Workspace not found." };
  if (ws.type !== "team") return { ok: false, error: "Only team workspaces can be shared." };

  const invitee = await prisma.user.findUnique({ where: { email } });
  if (!invitee) {
    return { ok: false, error: "No CollabCanvas account with that email." };
  }
  if (invitee.id === ws.ownerId && role !== "editor") {
    return { ok: false, error: "The workspace owner is always an editor." };
  }

  await prisma.workspaceMember.upsert({
    where: { workspaceId_userId: { workspaceId, userId: invitee.id } },
    create: { workspaceId, userId: invitee.id, role },
    update: { role },
  });

  // Fan out to current boards/pages/databases so the invitee gets socket access.
  const [boards, pages, databases] = await Promise.all([
    prisma.board.findMany({ where: { workspaceId }, select: { id: true, ownerId: true } }),
    prisma.page.findMany({ where: { workspaceId }, select: { id: true, ownerId: true } }),
    prisma.database.findMany({ where: { workspaceId }, select: { id: true, ownerId: true } }),
  ]);
  await prisma.$transaction([
    ...boards
      .filter((b) => b.ownerId !== invitee.id)
      .map((b) =>
        prisma.boardMember.upsert({
          where: { boardId_userId: { boardId: b.id, userId: invitee.id } },
          create: { boardId: b.id, userId: invitee.id, role },
          update: { role },
        }),
      ),
    ...pages
      .filter((p) => p.ownerId !== invitee.id)
      .map((p) =>
        prisma.pageMember.upsert({
          where: { pageId_userId: { pageId: p.id, userId: invitee.id } },
          create: { pageId: p.id, userId: invitee.id, role },
          update: { role },
        }),
      ),
    ...databases
      .filter((d) => d.ownerId !== invitee.id)
      .map((d) =>
        prisma.databaseMember.upsert({
          where: { databaseId_userId: { databaseId: d.id, userId: invitee.id } },
          create: { databaseId: d.id, userId: invitee.id, role },
          update: { role },
        }),
      ),
  ]);

  return { ok: true };
}
