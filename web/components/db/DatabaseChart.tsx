"use client";

/**
 * DatabaseChart (N6) — pure presentational bar/pie over aggregated ChartData.
 * ZERO Yjs. Follows the dataviz method: bars are ONE measure so they share a
 * single hue (category = x-axis label, not color); the pie uses the validated
 * categorical palette (--chart-1..6, own dark-mode steps) in fixed order. Every
 * mark gets a 2px ink border + direct labels, and a table view is always
 * rendered — the relief the palette's contrast WARN requires. Hover = native
 * <title>.
 */

import type { ChartDatum } from "@/lib/db/dbView";

const PALETTE = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
];

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

function BarChart({ data, measureLabel }: { data: ChartDatum[]; measureLabel: string }) {
  const W = 620;
  const H = 300;
  const padL = 12;
  const padR = 12;
  const padTop = 24;
  const padBottom = 56;
  const plotW = W - padL - padR;
  const plotH = H - padTop - padBottom;
  const max = Math.max(1, ...data.map((d) => d.value));
  const n = data.length || 1;
  const gap = 8;
  const barW = Math.max(6, (plotW - gap * (n - 1)) / n);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Bar chart of ${measureLabel} by category`}>
      {/* baseline */}
      <line x1={padL} y1={padTop + plotH} x2={W - padR} y2={padTop + plotH} stroke="var(--line)" strokeWidth={2} />
      {data.map((d, i) => {
        const h = (d.value / max) * plotH;
        const x = padL + i * (barW + gap);
        const y = padTop + plotH - h;
        return (
          <g key={d.label}>
            <title>{`${d.label}: ${fmt(d.value)}`}</title>
            <rect
              x={x}
              y={y}
              width={barW}
              height={Math.max(1, h)}
              rx={3}
              fill="var(--chart-1)"
              stroke="var(--line)"
              strokeWidth={2}
            />
            {/* direct value label above the bar */}
            <text x={x + barW / 2} y={y - 6} textAnchor="middle" fontSize={11} fontWeight={700} fill="var(--ink)">
              {fmt(d.value)}
            </text>
            {/* category label below */}
            <text
              x={x + barW / 2}
              y={padTop + plotH + 16}
              textAnchor="middle"
              fontSize={10.5}
              fill="var(--ink-soft)"
            >
              {d.label.length > 12 ? `${d.label.slice(0, 11)}…` : d.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function PieChart({ data }: { data: ChartDatum[] }) {
  const total = data.reduce((a, d) => a + Math.max(0, d.value), 0);
  const size = 300;
  const r = 120;
  const cx = size / 2;
  const cy = size / 2;

  if (total <= 0) {
    return <div className="p-6 font-sans text-[12.5px] text-[var(--ink-soft)]">No positive values to chart.</div>;
  }

  // Pure prefix-sum of fractions (no render-var mutation); n ≤ MAX_CATEGORIES.
  const fracs = data.map((d) => Math.max(0, d.value) / total);
  const starts = fracs.map((_, i) => fracs.slice(0, i).reduce((a, b) => a + b, 0));
  const slices = data.map((d, i) => {
    const frac = fracs[i];
    const a0 = -Math.PI / 2 + starts[i] * Math.PI * 2;
    const a1 = a0 + frac * Math.PI * 2;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const x0 = cx + r * Math.cos(a0);
    const y0 = cy + r * Math.sin(a0);
    const x1 = cx + r * Math.cos(a1);
    const y1 = cy + r * Math.sin(a1);
    const path = `M ${cx} ${cy} L ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} Z`;
    return { d, path, color: PALETTE[i % PALETTE.length], frac };
  });

  return (
    <div className="flex flex-wrap items-center gap-6">
      <svg viewBox={`0 0 ${size} ${size}`} width={240} height={240} role="img" aria-label="Pie chart">
        {slices.map((s) => (
          <path key={s.d.label} d={s.path} fill={s.color} stroke="var(--line)" strokeWidth={2}>
            <title>{`${s.d.label}: ${fmt(s.d.value)} (${Math.round(s.frac * 100)}%)`}</title>
          </path>
        ))}
      </svg>
      {/* legend — identity is never color-alone (label + value beside each swatch) */}
      <ul className="m-0 flex flex-col gap-1.5 p-0">
        {slices.map((s) => (
          <li key={s.d.label} className="flex items-center gap-2">
            <span
              className="h-3 w-3 flex-none rounded-[3px] border-2 border-[var(--line)]"
              style={{ background: s.color }}
            />
            <span className="font-sans text-[12px] font-semibold text-[var(--ink)]">{s.d.label}</span>
            <span className="font-mono text-[11px] text-[var(--ink-soft)]">
              {fmt(s.d.value)} · {Math.round(s.frac * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function DatabaseChart({
  data,
  type,
  measureLabel,
}: {
  data: ChartDatum[];
  type: "bar" | "pie";
  measureLabel: string;
}) {
  if (data.length === 0) {
    return (
      <div className="rounded-2xl border-[2.5px] border-dashed border-[var(--line)] bg-[var(--sunk)] p-8 text-center font-sans text-[12.5px] text-[var(--ink-soft)]">
        No data to chart yet — add rows, then pick a group-by column.
      </div>
    );
  }
  return (
    <div className="rounded-2xl border-[2.5px] border-[var(--line)] bg-[var(--surface)] p-5 shadow-[4px_4px_0_var(--shadow)]">
      {type === "bar" ? <BarChart data={data} measureLabel={measureLabel} /> : <PieChart data={data} />}

      {/* Table view — always present (accessibility + the contrast-WARN relief). */}
      <details className="mt-4">
        <summary className="cursor-pointer font-sans text-[11.5px] font-semibold text-[var(--ink-soft)]">
          Show data table
        </summary>
        <table className="mt-2 w-full border-collapse text-left">
          <thead>
            <tr className="border-b-2 border-[var(--line)]">
              <th className="px-2 py-1 font-display text-[11.5px] font-semibold text-[var(--ink)]">Category</th>
              <th className="px-2 py-1 text-right font-display text-[11.5px] font-semibold text-[var(--ink)]">
                {measureLabel}
              </th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.label} className="border-b border-[var(--line)]">
                <td className="px-2 py-1 font-sans text-[11.5px] text-[var(--ink)]">{d.label}</td>
                <td className="px-2 py-1 text-right font-mono text-[11.5px] text-[var(--ink)]">{fmt(d.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
