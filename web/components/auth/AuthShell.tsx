import Link from "next/link";

/** Centered card shell shared by the Phase 7 auth pages. */
export function AuthShell({
  title,
  blurb,
  children,
}: {
  title: string;
  blurb: string;
  children: React.ReactNode;
}) {
  return (
    <main className="cc-dots flex min-h-dvh flex-col items-center justify-center gap-6 p-8 text-center">
      <Link href="/" className="flex items-center gap-3">
        <div className="flex h-[42px] w-[42px] -rotate-[4deg] items-center justify-center rounded-[10px] border-[2.5px] border-[var(--line)] bg-[var(--sun)] font-display text-xl font-semibold text-[#1c1a17] shadow-[2.5px_2.5px_0_var(--shadow)]">
          C
        </div>
        <span className="font-display text-3xl font-semibold text-[var(--ink)]">
          CollabCanvas
        </span>
      </Link>
      <div className="flex flex-col items-center gap-2">
        <h1 className="m-0 font-display text-xl font-semibold text-[var(--ink)]">
          {title}
        </h1>
        <p className="m-0 max-w-md font-sans text-[13px] text-[var(--ink-soft)]">
          {blurb}
        </p>
      </div>
      {children}
    </main>
  );
}
