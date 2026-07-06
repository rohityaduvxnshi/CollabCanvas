import Link from "next/link";
import { redirect } from "next/navigation";
import { LIMITS } from "@collabcanvas/shared";
import { auth } from "@/lib/auth";
import { listUserFiles } from "@/lib/files";
import { userUsageBytes } from "@/lib/attachments";
import { FileManager } from "@/components/files/FileManager";

const gb = (n: number) => (n / (1024 * 1024 * 1024)).toFixed(2);

export default async function FilesPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/");

  const [files, used] = await Promise.all([
    listUserFiles(session.user.id),
    userUsageBytes(session.user.id),
  ]);
  const cap = LIMITS.userStorageBytes;
  const pct = Math.min(100, Math.round((used / cap) * 100));

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex flex-none items-center gap-[11px] border-b-[2.5px] border-[var(--line)] bg-[var(--surface)] px-5 py-3">
        <Link href="/" className="flex items-center gap-[11px]">
          <div className="flex h-[34px] w-[34px] -rotate-[4deg] items-center justify-center rounded-[10px] border-[2.5px] border-[var(--line)] bg-[var(--sun)] font-display text-base font-semibold text-[#1c1a17] shadow-[2.5px_2.5px_0_var(--shadow)]">
            C
          </div>
          <span className="font-display text-lg font-semibold text-[var(--ink)]">
            CollabCanvas
          </span>
        </Link>
        <Link
          href="/"
          className="ml-auto cc-press rounded-[9px] border-2 border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-1.5 font-sans text-[12.5px] font-semibold text-[var(--ink)] shadow-[2px_2px_0_var(--shadow)]"
        >
          ← Dashboard
        </Link>
      </header>

      <div className="cc-dots min-h-0 flex-1 overflow-y-auto px-6 py-8 lg:px-10">
        <div className="mx-auto max-w-[1000px]">
          <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="m-0 font-display text-[26px] font-semibold text-[var(--ink)]">
                Your files
              </h1>
              <p className="mt-1 font-sans text-[12.5px] text-[var(--ink-soft)]">
                Everything you&apos;ve attached to boards and databases, in one place.
              </p>
            </div>
            <div className="min-w-[220px]">
              <div className="mb-1 flex justify-between font-sans text-[11.5px] font-semibold text-[var(--ink-soft)]">
                <span>{gb(used)} GB used</span>
                <span>{gb(cap)} GB</span>
              </div>
              <div className="h-3 w-full overflow-hidden rounded-full border-2 border-[var(--line)] bg-[var(--surface-2)]">
                <div
                  className="h-full bg-[var(--sun)]"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          </div>

          <FileManager initial={files} />
        </div>
      </div>
    </div>
  );
}
