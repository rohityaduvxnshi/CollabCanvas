"use client";

/**
 * Presentational: one remote peer's live cursor (design: solid triangle with a
 * hard drop-shadow + name pill). Positioned in board-CONTENT coordinates — the
 * parent layer lives inside the scrollable board area, so cursors stay glued to
 * the content regardless of each user's scroll position. Pure.
 */

export interface CursorProps {
  name: string;
  color: string;
  x: number;
  y: number;
}

export function Cursor({ name, color, x, y }: CursorProps) {
  return (
    <div
      className="pointer-events-none absolute left-0 top-0 z-30 transition-transform duration-100 ease-out"
      style={{ transform: `translate3d(${x}px, ${y}px, 0)` }}
      aria-hidden
    >
      <div
        style={{
          width: 0,
          height: 0,
          borderTop: `16px solid ${color}`,
          borderRight: "11px solid transparent",
          filter: "drop-shadow(1px 2px 0 var(--shadow))",
        }}
      />
      <div
        className="ml-[9px] mt-[-3px] w-max rounded-lg rounded-tl-sm border-[1.5px] border-[var(--line)] px-2 py-0.5 font-sans text-[10px] font-bold text-[#1c1a17] shadow-[1.5px_1.5px_0_var(--shadow)]"
        style={{ background: color }}
      >
        {name}
      </div>
    </div>
  );
}
