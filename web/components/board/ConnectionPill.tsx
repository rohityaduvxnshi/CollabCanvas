"use client";

/** Presentational: connection-status pill (design: uppercase chip, hard border,
 *  colored fill per status, pulsing dot while connecting). Pure. */

import type { ConnectionStatus } from "@collabcanvas/shared";

const STYLES: Record<ConnectionStatus, { label: string; bg: string; pulse: boolean }> = {
  connecting: { label: "Connecting", bg: "var(--sun)", pulse: true },
  connected: { label: "Live", bg: "var(--green)", pulse: false },
  disconnected: { label: "Reconnecting", bg: "var(--hot)", pulse: true },
  offline: { label: "Offline", bg: "var(--pill-off)", pulse: false },
};

export function ConnectionPill({ status }: { status: ConnectionStatus }) {
  const s = STYLES[status];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border-2 border-[var(--line)] px-2.5 py-0.5 font-sans text-[11px] font-bold uppercase tracking-wider text-[#1c1a17]"
      style={{ background: s.bg }}
    >
      <span
        className="h-2 w-2 rounded-full bg-[#1c1a17]"
        style={s.pulse ? { animation: "ccpulse 1.1s ease-in-out infinite" } : undefined}
      />
      {s.label}
    </span>
  );
}
