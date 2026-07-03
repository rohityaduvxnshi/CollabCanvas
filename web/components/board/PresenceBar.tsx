"use client";

/** Presentational: overlapping avatar stack of everyone else on the board
 *  (design: 29px ink-bordered circles, surface ring, green online dot). Pure. */

/* eslint-disable @next/next/no-img-element -- avatars are tiny, remote, and
   user-provided; next/image adds no value here */

import type { PeerPresence } from "@collabcanvas/shared";

const MAX_SHOWN = 5;

const initials = (name: string): string =>
  name
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

export function PresenceBar({ peers }: { peers: PeerPresence[] }) {
  if (peers.length === 0) return null;

  const shown = peers.slice(0, MAX_SHOWN);
  const overflow = peers.length - shown.length;

  return (
    <div className="flex items-center" title={peers.map((p) => p.name).join(", ")}>
      {shown.map((peer, i) => (
        <span
          key={peer.clientId}
          className="relative flex h-[29px] w-[29px] items-center justify-center overflow-hidden rounded-full border-2 border-[var(--line)] font-sans text-[10.5px] font-bold text-[#1c1a17] shadow-[0_0_0_2px_var(--surface)]"
          style={{ background: peer.color, marginLeft: i === 0 ? 0 : -7 }}
          title={peer.name}
        >
          {peer.image ? (
            <img src={peer.image} alt={peer.name} className="h-full w-full object-cover" />
          ) : (
            initials(peer.name)
          )}
        </span>
      ))}
      {overflow > 0 && (
        <span className="z-10 -ml-2 flex h-[29px] w-[29px] items-center justify-center rounded-full border-2 border-[var(--line)] bg-[var(--surface-2)] font-sans text-[10px] font-bold text-[var(--ink)] shadow-[0_0_0_2px_var(--surface)]">
          +{overflow}
        </span>
      )}
    </div>
  );
}
