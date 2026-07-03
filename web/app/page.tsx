import Link from "next/link";
import { auth } from "@/lib/auth";
import { listBoardsForUser } from "@/lib/boards";
import {
  createBoardFromForm,
  signInAction,
  signOutAction,
} from "@/lib/actions";

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

      <div className="flex flex-col gap-2.5">
        <form
          action={async () => {
            "use server";
            await signInAction("github");
          }}
        >
          <button className="cc-press w-64 rounded-[11px] border-[2.5px] border-[var(--line)] bg-[var(--ink)] px-5 py-2.5 font-display text-sm font-semibold text-[var(--app)] shadow-[3px_3px_0_var(--shadow)]">
            Continue with GitHub
          </button>
        </form>
        <form
          action={async () => {
            "use server";
            await signInAction("google");
          }}
        >
          <button className="cc-press w-64 rounded-[11px] border-[2.5px] border-[var(--line)] bg-[var(--surface)] px-5 py-2.5 font-display text-sm font-semibold text-[var(--ink)] shadow-[3px_3px_0_var(--shadow)]">
            Continue with Google
          </button>
        </form>
      </div>

      <p className="max-w-md font-mono text-[10.5px] text-[var(--ink-faint)]">
        Boards sync live — open the same board in two windows and watch them
        mirror.
      </p>
    </main>
  );
}

export default async function Home() {
  const session = await auth();
  if (!session?.user?.id) return <Landing />;

  const boards = await listBoardsForUser(session.user.id);
  const you = session.user.name ?? session.user.email ?? "You";
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

      <div className="cc-dots min-h-0 flex-1 overflow-y-auto px-6 py-8">
        <div className="mx-auto max-w-[920px]">
          <div className="mb-5 flex flex-wrap items-center gap-3">
            <h1 className="m-0 font-display text-[26px] font-semibold text-[var(--ink)]">
              Your boards
            </h1>
            <span className="rounded-full border-2 border-[var(--line)] bg-[var(--surface)] px-2 py-0.5 font-mono text-[11px] font-bold text-[var(--ink-soft)]">
              {boards.length}
            </span>
            <form action={createBoardFromForm} className="ml-auto flex gap-[7px]">
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
            <div className="rounded-2xl border-[2.5px] border-dashed border-[var(--line)] bg-[var(--sunk)] p-10 text-center">
              <div className="mb-1.5 font-display text-lg font-semibold text-[var(--ink)]">
                No boards yet
              </div>
              <div className="font-sans text-[12.5px] text-[var(--ink-soft)]">
                Create your first board above — then share it with your team.
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

          <div className="mt-7 font-mono text-[10.5px] text-[var(--ink-faint)]">
            Boards sync live — open the same board in two windows and watch them mirror.
          </div>
        </div>
      </div>
    </div>
  );
}
