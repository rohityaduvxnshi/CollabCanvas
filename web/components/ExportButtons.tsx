"use client";

/** Compact export control (N8): a labeled row of download/print buttons. */
export function ExportButtons({
  items,
}: {
  items: { label: string; onClick: () => void; title?: string }[];
}) {
  return (
    <div className="flex flex-none items-center gap-1">
      <span className="font-sans text-[10.5px] font-semibold text-[var(--ink-faint)]">Export</span>
      {items.map((it) => (
        <button
          key={it.label}
          onClick={it.onClick}
          title={it.title}
          className="cc-press rounded-[8px] border-2 border-[var(--line)] bg-[var(--surface-2)] px-2 py-1 font-sans text-[11px] font-semibold text-[var(--ink)] shadow-[1.5px_1.5px_0_var(--shadow)]"
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}
