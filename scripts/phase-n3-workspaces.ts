/**
 * N3 workspaces harness — exercises the REAL web/lib/workspaces.ts functions
 * against the local dev Postgres (workspaces.ts drops "server-only" for this,
 * same as emailAuth.ts). Focus: the security-critical guarantee that sharing a
 * team workspace grants the invitee access THROUGH the existing Board/PageMember
 * path (so getMembership + ws-token — already proven in phase4 — let them in),
 * and that it does NOT leak access to other workspaces.
 *
 * Run:  npx tsx scripts/phase-n3-workspaces.ts   (no servers needed)
 */

process.loadEnvFile("packages/db/.env");

import { getPrisma } from "../packages/db/src/index";
import {
  addWorkspaceMembersToBoard,
  addWorkspaceMembersToDatabase,
  addWorkspaceMembersToPage,
  createTeamWorkspace,
  ensurePrivateWorkspace,
  getWorkspaceMembership,
  listWorkspacesForUser,
  shareWorkspace,
  workspaceContents,
} from "../web/lib/workspaces";

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean) {
  console.log(`${ok ? "✅" : "❌"} ${name}`);
  ok ? passed++ : failed++;
}

const prisma = getPrisma();

async function mkUser(tag: string) {
  const email = `n3-${tag}@test.local`;
  return prisma.user.upsert({
    where: { email },
    create: { email, name: `N3 ${tag}` },
    update: {},
  });
}

async function hasBoardMember(boardId: string, userId: string): Promise<boolean> {
  return !!(await prisma.boardMember.findUnique({
    where: { boardId_userId: { boardId, userId } },
  }));
}
async function hasPageMember(pageId: string, userId: string): Promise<boolean> {
  return !!(await prisma.pageMember.findUnique({
    where: { pageId_userId: { pageId, userId } },
  }));
}
async function hasDatabaseMember(databaseId: string, userId: string): Promise<boolean> {
  return !!(await prisma.databaseMember.findUnique({
    where: { databaseId_userId: { databaseId, userId } },
  }));
}

async function main() {
  const owner = await mkUser("owner");
  const teammate = await mkUser("teammate");
  const stranger = await mkUser("stranger");

  // Clean slate: remove any workspaces/boards/pages these users own.
  for (const u of [owner, teammate, stranger]) {
    await prisma.board.deleteMany({ where: { ownerId: u.id } });
    await prisma.page.deleteMany({ where: { ownerId: u.id } });
    await prisma.database.deleteMany({ where: { ownerId: u.id } });
    await prisma.workspace.deleteMany({ where: { ownerId: u.id } });
  }

  // -- Private workspace: auto-create + idempotent ------------------------
  const priv1 = await ensurePrivateWorkspace(owner.id);
  const priv2 = await ensurePrivateWorkspace(owner.id);
  check("ensurePrivateWorkspace is idempotent", priv1 === priv2);

  // -- Team workspace: owner is an editor member --------------------------
  const teamId = await createTeamWorkspace(owner.id, "Team A");
  check("team workspace owner is editor", (await getWorkspaceMembership(teamId, owner.id)) === "editor");
  check("non-member has no workspace role", (await getWorkspaceMembership(teamId, stranger.id)) === null);

  // A board + page filed in the team workspace (owner is the sole member so far).
  const board1 = await prisma.board.create({
    data: {
      title: "Team board 1",
      ownerId: owner.id,
      workspaceId: teamId,
      members: { create: { userId: owner.id, role: "editor" } },
    },
  });
  const page1 = await prisma.page.create({
    data: {
      title: "Team page 1",
      ownerId: owner.id,
      workspaceId: teamId,
      members: { create: { userId: owner.id, role: "editor" } },
    },
  });

  // A board in the owner's PRIVATE workspace — must stay isolated from the team share.
  const privBoard = await prisma.board.create({
    data: {
      title: "Private board",
      ownerId: owner.id,
      workspaceId: priv1,
      members: { create: { userId: owner.id, role: "editor" } },
    },
  });
  // A legacy board (workspaceId = null) owned by owner.
  const legacyBoard = await prisma.board.create({
    data: {
      title: "Legacy board",
      ownerId: owner.id,
      members: { create: { userId: owner.id, role: "editor" } },
    },
  });

  const db1 = await prisma.database.create({
    data: {
      title: "Team db 1",
      ownerId: owner.id,
      workspaceId: teamId,
      members: { create: { userId: owner.id, role: "editor" } },
    },
  });

  // -- Share the team workspace: fan-out to existing board + page + db ----
  const shared = await shareWorkspace(teamId, teammate.email, "editor");
  check("shareWorkspace succeeds", shared.ok === true);
  check("invitee is now a workspace member", (await getWorkspaceMembership(teamId, teammate.id)) === "editor");
  check("SECURITY: invitee got BoardMember for the team board (socket access)", await hasBoardMember(board1.id, teammate.id));
  check("SECURITY: invitee got PageMember for the team page", await hasPageMember(page1.id, teammate.id));
  check("SECURITY: invitee got DatabaseMember for the team database", await hasDatabaseMember(db1.id, teammate.id));
  check("ISOLATION: invitee did NOT get the owner's private board", !(await hasBoardMember(privBoard.id, teammate.id)));
  check("ISOLATION: invitee did NOT get the legacy board", !(await hasBoardMember(legacyBoard.id, teammate.id)));

  // -- New board in the team ws AFTER share inherits members --------------
  const board2 = await prisma.board.create({
    data: {
      title: "Team board 2",
      ownerId: owner.id,
      workspaceId: teamId,
      members: { create: { userId: owner.id, role: "editor" } },
    },
  });
  await addWorkspaceMembersToBoard(teamId, board2.id);
  check("new team board inherits the workspace members", await hasBoardMember(board2.id, teammate.id));

  const page2 = await prisma.page.create({
    data: {
      title: "Team page 2",
      ownerId: owner.id,
      workspaceId: teamId,
      members: { create: { userId: owner.id, role: "editor" } },
    },
  });
  await addWorkspaceMembersToPage(teamId, page2.id);
  check("new team page inherits the workspace members", await hasPageMember(page2.id, teammate.id));

  const db2 = await prisma.database.create({
    data: {
      title: "Team db 2",
      ownerId: owner.id,
      workspaceId: teamId,
      members: { create: { userId: owner.id, role: "editor" } },
    },
  });
  await addWorkspaceMembersToDatabase(teamId, db2.id);
  check("new team database inherits the workspace members", await hasDatabaseMember(db2.id, teammate.id));

  // -- workspaceContents filtering ---------------------------------------
  const teamForTeammate = await workspaceContents(teamId, teammate.id, false);
  check(
    "teammate sees both team boards",
    teamForTeammate.boards.length === 2 &&
      teamForTeammate.boards.every((b) => [board1.id, board2.id].includes(b.id)),
  );
  check("teammate sees both team pages", teamForTeammate.pages.length === 2);

  const privForOwner = await workspaceContents(priv1, owner.id, true);
  const privIds = privForOwner.boards.map((b) => b.id);
  check("owner's private view includes the private board", privIds.includes(privBoard.id));
  check("owner's private view includes the legacy (null-workspace) board", privIds.includes(legacyBoard.id));
  check("owner's private view excludes the team board", !privIds.includes(board1.id));

  const teamForStranger = await workspaceContents(teamId, stranger.id, false);
  check("stranger sees nothing in the team workspace", teamForStranger.boards.length === 0 && teamForStranger.pages.length === 0);

  // -- listWorkspacesForUser ---------------------------------------------
  const ownerWs = await listWorkspacesForUser(owner.id);
  check("owner lists Private + Team", ownerWs.some((w) => w.type === "private") && ownerWs.some((w) => w.id === teamId));
  const teammateWs = await listWorkspacesForUser(teammate.id);
  check("teammate lists their Private + the shared Team", teammateWs.some((w) => w.type === "private") && teammateWs.some((w) => w.id === teamId));

  // -- security: only team workspaces are shareable, unknown email fails --
  const shareprivate = await shareWorkspace(priv1, teammate.email, "editor");
  check("cannot share a PRIVATE workspace", shareprivate.ok === false);
  const shareunknown = await shareWorkspace(teamId, "nobody@test.local", "editor");
  check("sharing to an unknown email fails", shareunknown.ok === false);

  console.log(`\nphase-n3: ${passed}/${passed + failed} checks passed`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
