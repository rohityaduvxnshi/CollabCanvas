import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getPrisma } from "@collabcanvas/db";
import {
  listWorkspacesForUser,
  workspaceContents,
  type WorkspaceView,
} from "@/lib/workspaces";
import {
  createBoardFromForm,
  createDatabaseFromForm,
  createPageFromForm,
  createWorkspaceFromForm,
  shareWorkspaceFromForm,
  signOutAction,
} from "@/lib/actions";
import { EmailFirstForm } from "@/components/auth/AuthForms";

const BANDS = [
  "var(--band-violet)",
  "var(--band-coral)",
  "var(--band-teal)",
  "var(--band-sun)",
  "var(--band-sky)",
  "var(--band-pink)",
];

function Landing() {
  return (
    <main className="cc-dots flex min-h-dvh flex-col items-center justify-center gap-6 p-8 text-center">
      <div className="flex items-center gap-3">
        <div className="flex h-[42px] w-[42px] -rotate-[4deg] items-center justify-center rounded-[10px] border-[2.5px] border-[var(--line)] bg-[var(--sun)] font-display text-xl font-semibold text-[#1c1a17] shadow-[2.5px_2.5px_0_var(--shadow)]">
          C
        </div>
        <h1 className="font-display text-3xl font-semibold text-[var(--ink)]">
          CollabCanvas
        </h1>
      </div>
      <p className="max-w-md font-sans text-[var(--ink-soft)]">
        A real-time collaborative kanban board. Edits merge conflict-free, you
        see everyone&apos;s cursors, and offline changes sync when you&apos;re back.
      </p>

      <EmailFirstForm />

      <p className="max-w-md font-mono text-[10.5px] text-[var(--ink-faint)]">
        Enter your email to sign in or create an account.
      </p>
    </main>
  );
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ ws?: string; invited?: string; shareError?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) return <Landing />;

  // Onboarding is data-derived (Ph7): name-less users finish their profile.
  const me = await getPrisma().user.findUnique({ where: { id: session.user.id } });
  if (me && !me.name) redirect("/welcome");

  const { ws, invited, shareError } = await searchParams;
  const workspaces = await listWorkspacesForUser(session.user.id);
  const selected: WorkspaceView =
    workspaces.find((w) => w.id === ws) ??
    workspaces.find((w) => w.type === "private") ??
    workspaces[0];
  const { boards, pages, databases } = await workspaceContents(
    selected.id,
    session.user.id,
    selected.type === "private",
  );

  const you = me?.name ?? session.user.name ?? session.user.email ?? "You";
  const initials = you
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex flex-none items-center gap-[11px] border-b-[2.5px] border-[var(--line)] bg-[var(--surface)] px-5 py-3">
        <div className="flex h-[34px] w-[34px] -rotate-[4deg] items-center justify-center rounded-[10px] border-[2.5px] border-[var(--line)] bg-[var(--sun)] font-display text-base font-semibold text-[#1c1a17] shadow-[2.5px_2.5px_0_var(--shadow)]">
          C
        </div>
        <div className="font-display text-lg font-semibold text-[var(--ink)]">
          CollabCanvas
        </div>
        <div className="ml-auto flex items-center gap-2.5">
          <span
            className="flex h-[30px] w-[30px] items-center justify-center rounded-full border-2 border-[var(--line)] bg-[var(--sun)] font-sans text-[10.5px] font-bold text-[#1c1a17]"
            title={you}
          >
            {initials}
          </span>
          <form action={signOutAction}>
            <button className="cc-press rounded-[9px] border-2 border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-1.5 font-sans text-[12.5px] font-semibold text-[var(--ink)] shadow-[2px_2px_0_var(--shadow)]">
              Sign out
            </button>
          </form>
        </div>
      </header>

      <div className="cc-dots min-h-0 flex-1 overflow-y-auto px-6 py-8 lg:px-10">
        <div className="mx-auto max-w-[1400px]">
          {/* Workspace switcher */}
          <div className="mb-6 flex flex-wrap items-center gap-2">
            {workspaces.map((w) => (
              <Link
                key={w.id}
                href={`/?ws=${w.id}`}
                className={`rounded-full border-2 border-[var(--line)] px-3.5 py-1.5 font-display text-[13px] font-semibold shadow-[2px_2px_0_var(--shadow)] ${
                  w.id === selected.id
                    ? "bg-[var(--ink)] text-[var(--app)]"
                    : "bg-[var(--surface)] text-[var(--ink)]"
                }`}
              >
                {w.type === "private" ? "🔒 " : "👥 "}
                {w.name}
              </Link>
            ))}
            <form action={createWorkspaceFromForm} className="flex gap-[7px]">
              <input
                name="name"
                required
                placeholder="New team…"
                aria-label="New team workspace name"
                className="w-[130px] rounded-full border-2 border-[var(--line)] bg-[var(--surface)] px-3 py-1.5 font-sans text-[12.5px] font-semibold text-[var(--ink)] outline-none"
              />
              <button className="cc-press rounded-full border-2 border-[var(--line)] bg-[var(--band-violet)] px-3 py-1.5 font-display text-[12.5px] font-semibold text-[#1c1a17] shadow-[2px_2px_0_var(--shadow)]">
                + Team
              </button>
            </form>
          </div>

          {/* Team-workspace sharing */}
          {selected.type === "team" && selected.isOwner ? (
            <div className="mb-6 rounded-2xl border-[2.5px] border-[var(--line)] bg-[var(--surface)] p-4 shadow-[3px_3px_0_var(--shadow)]">
              <div className="mb-2 font-display text-[14px] font-semibold text-[var(--ink)]">
                Share “{selected.name}”
              </div>
              {invited ? (
                <p className="mb-2 rounded-[9px] border-2 border-[var(--line)] bg-[var(--band-teal)] px-3 py-1.5 font-sans text-[12px] font-semibold text-[#1c1a17]">
                  Invited {invited} — they now have access to everything in this workspace.
                </p>
              ) : null}
              {shareError ? (
                <p className="mb-2 rounded-[9px] border-2 border-[var(--line)] bg-[var(--band-coral)] px-3 py-1.5 font-sans text-[12px] font-semibold text-[#1c1a17]">
                  {shareError}
                </p>
              ) : null}
              <form action={shareWorkspaceFromForm} className="flex flex-wrap gap-[7px]">
                <input type="hidden" name="workspaceId" value={selected.id} />
                <input
                  name="email"
                  type="email"
                  required
                  placeholder="teammate@example.com"
                  aria-label="Invite email"
                  className="min-w-[200px] flex-1 rounded-[10px] border-2 border-[var(--line)] bg-[var(--surface-2)] px-[11px] py-2 font-sans text-[12.5px] font-semibold text-[var(--ink)] outline-none"
                />
                <select
                  name="role"
                  aria-label="Role"
                  className="rounded-[10px] border-2 border-[var(--line)] bg-[var(--surface-2)] px-2 py-2 font-sans text-[12.5px] font-semibold text-[var(--ink)] outline-none"
                >
                  <option value="editor">Editor</option>
                  <option value="viewer">Viewer</option>
                </select>
                <button className="cc-press rounded-[10px] border-2 border-[var(--line)] bg-[var(--sun)] px-[15px] py-2 font-display text-[13px] font-semibold text-[#1c1a17] shadow-[2px_2px_0_var(--shadow)]">
                  Invite
                </button>
              </form>
            </div>
          ) : null}

          {/* Boards */}
          <div className="mb-5 flex flex-wrap items-center gap-3">
            <h1 className="m-0 font-display text-[26px] font-semibold text-[var(--ink)]">
              Boards
            </h1>
            <span className="rounded-full border-2 border-[var(--line)] bg-[var(--surface)] px-2 py-0.5 font-mono text-[11px] font-bold text-[var(--ink-soft)]">
              {boards.length}
            </span>
            <form action={createBoardFromForm} className="ml-auto flex gap-[7px]">
              <input type="hidden" name="workspaceId" value={selected.id} />
              <input
                name="title"
                required
                placeholder="Name a new board…"
                aria-label="New board name"
                className="w-[200px] rounded-[10px] border-2 border-[var(--line)] bg-[var(--surface)] px-[11px] py-2 font-sans text-[12.5px] font-semibold text-[var(--ink)] outline-none"
              />
              <button className="cc-press rounded-[10px] border-2 border-[var(--line)] bg-[var(--sun)] px-[15px] py-2 font-display text-[13px] font-semibold text-[#1c1a17] shadow-[2px_2px_0_var(--shadow)]">
                + Create
              </button>
            </form>
          </div>

          {boards.length === 0 ? (
            <div className="rounded-2xl border-[2.5px] border-dashed border-[var(--line)] bg-[var(--sunk)] p-8 text-center">
              <div className="mb-1.5 font-display text-base font-semibold text-[var(--ink)]">
                No boards in {selected.name} yet
              </div>
              <div className="font-sans text-[12.5px] text-[var(--ink-soft)]">
                Create your first board above.
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(255px,1fr))] gap-[18px]">
              {boards.map((b, i) => (
                <Link
                  key={b.id}
                  href={`/boards/${b.id}`}
                  className="overflow-hidden rounded-2xl border-[2.5px] border-[var(--line)] bg-[var(--surface)] shadow-[4px_4px_0_var(--shadow)] transition-transform hover:-translate-y-0.5"
                >
                  <div
                    className="flex h-[42px] items-center justify-end border-b-[2.5px] border-[var(--line)] px-2.5"
                    style={{ background: BANDS[i % BANDS.length] }}
                  >
                    <span
                      className={`whitespace-nowrap rounded-full border-[1.5px] bg-[var(--paper)] px-2 py-0.5 font-sans text-[9.5px] font-bold text-[#1c1a17] ${
                        b.role === "editor"
                          ? "border-[var(--chip-line)]"
                          : "border-dashed border-[var(--chip-line)]"
                      }`}
                    >
                      {b.role === "editor" ? "Editor" : "View only"}
                    </span>
                  </div>
                  <div className="px-[15px] pb-3.5 pt-[13px]">
                    <div className="mb-1 truncate font-display text-base font-semibold text-[var(--ink)]">
                      {b.title}
                    </div>
                    <div className="font-sans text-[11.5px] text-[var(--ink-soft)]">
                      created {b.createdAt.toLocaleDateString()}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}

          {/* Pages */}
          <div className="mb-5 mt-10 flex flex-wrap items-center gap-3">
            <h1 className="m-0 font-display text-[26px] font-semibold text-[var(--ink)]">
              Pages
            </h1>
            <span className="rounded-full border-2 border-[var(--line)] bg-[var(--surface)] px-2 py-0.5 font-mono text-[11px] font-bold text-[var(--ink-soft)]">
              {pages.length}
            </span>
            <form action={createPageFromForm} className="ml-auto flex gap-[7px]">
              <input type="hidden" name="workspaceId" value={selected.id} />
              <input
                name="title"
                placeholder="Name a new page…"
                aria-label="New page name"
                className="w-[200px] rounded-[10px] border-2 border-[var(--line)] bg-[var(--surface)] px-[11px] py-2 font-sans text-[12.5px] font-semibold text-[var(--ink)] outline-none"
              />
              <button className="cc-press rounded-[10px] border-2 border-[var(--line)] bg-[var(--teal)] px-[15px] py-2 font-display text-[13px] font-semibold text-[#1c1a17] shadow-[2px_2px_0_var(--shadow)]">
                + New page
              </button>
            </form>
          </div>

          {pages.length === 0 ? (
            <div className="rounded-2xl border-[2.5px] border-dashed border-[var(--line)] bg-[var(--sunk)] p-8 text-center">
              <div className="mb-1.5 font-display text-base font-semibold text-[var(--ink)]">
                No pages in {selected.name} yet
              </div>
              <div className="font-sans text-[12.5px] text-[var(--ink-soft)]">
                Pages are collaborative rich-text docs — create one above.
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(255px,1fr))] gap-[18px]">
              {pages.map((pg) => (
                <Link
                  key={pg.id}
                  href={`/pages/${pg.id}`}
                  className="flex items-center gap-2.5 rounded-2xl border-[2.5px] border-[var(--line)] bg-[var(--surface)] px-4 py-3.5 shadow-[4px_4px_0_var(--shadow)] transition-transform hover:-translate-y-0.5"
                >
                  <span className="flex h-8 w-8 flex-none items-center justify-center rounded-[9px] border-2 border-[var(--line)] bg-[var(--band-teal)] text-sm">
                    📄
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-display text-[15px] font-semibold text-[var(--ink)]">
                      {pg.title}
                    </span>
                    <span className="block font-sans text-[11px] text-[var(--ink-soft)]">
                      {pg.role === "editor" ? "Editor" : "View only"} · created{" "}
                      {pg.createdAt.toLocaleDateString()}
                    </span>
                  </span>
                </Link>
              ))}
            </div>
          )}

          {/* Databases */}
          <div className="mb-5 mt-10 flex flex-wrap items-center gap-3">
            <h1 className="m-0 font-display text-[26px] font-semibold text-[var(--ink)]">
              Databases
            </h1>
            <span className="rounded-full border-2 border-[var(--line)] bg-[var(--surface)] px-2 py-0.5 font-mono text-[11px] font-bold text-[var(--ink-soft)]">
              {databases.length}
            </span>
            <form action={createDatabaseFromForm} className="ml-auto flex gap-[7px]">
              <input type="hidden" name="workspaceId" value={selected.id} />
              <input
                name="title"
                placeholder="Name a new database…"
                aria-label="New database name"
                className="w-[200px] rounded-[10px] border-2 border-[var(--line)] bg-[var(--surface)] px-[11px] py-2 font-sans text-[12.5px] font-semibold text-[var(--ink)] outline-none"
              />
              <button className="cc-press rounded-[10px] border-2 border-[var(--line)] bg-[var(--band-violet)] px-[15px] py-2 font-display text-[13px] font-semibold text-[#1c1a17] shadow-[2px_2px_0_var(--shadow)]">
                + New database
              </button>
            </form>
          </div>

          {databases.length === 0 ? (
            <div className="rounded-2xl border-[2.5px] border-dashed border-[var(--line)] bg-[var(--sunk)] p-8 text-center">
              <div className="mb-1.5 font-display text-base font-semibold text-[var(--ink)]">
                No databases in {selected.name} yet
              </div>
              <div className="font-sans text-[12.5px] text-[var(--ink-soft)]">
                Databases are typed collaborative tables — create one above.
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(255px,1fr))] gap-[18px]">
              {databases.map((db) => (
                <Link
                  key={db.id}
                  href={`/databases/${db.id}`}
                  className="flex items-center gap-2.5 rounded-2xl border-[2.5px] border-[var(--line)] bg-[var(--surface)] px-4 py-3.5 shadow-[4px_4px_0_var(--shadow)] transition-transform hover:-translate-y-0.5"
                >
                  <span className="flex h-8 w-8 flex-none items-center justify-center rounded-[9px] border-2 border-[var(--line)] bg-[var(--band-violet)] text-sm">
                    🗃️
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-display text-[15px] font-semibold text-[var(--ink)]">
                      {db.title}
                    </span>
                    <span className="block font-sans text-[11px] text-[var(--ink-soft)]">
                      {db.role === "editor" ? "Editor" : "View only"} · created{" "}
                      {db.createdAt.toLocaleDateString()}
                    </span>
                  </span>
                </Link>
              ))}
            </div>
          )}

          <div className="mt-7 font-mono text-[10.5px] text-[var(--ink-faint)]">
            Boards, pages &amp; databases sync live — open the same one in two windows and watch them mirror.
          </div>
        </div>
      </div>
    </div>
  );
}
