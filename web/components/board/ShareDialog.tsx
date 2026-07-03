"use client";

/**
 * Presentational share dialog (from the Claude Design delivery): invite by
 * email with a role, plus the current member list. Pure — the container passes
 * `onShare` (a server action) and the members snapshot.
 */

import { useState, useTransition } from "react";
import type { Role } from "@collabcanvas/shared";

export interface ShareMember {
  name: string;
  email: string;
  role: Role;
  isYou: boolean;
}

export interface ShareDialogProps {
  open: boolean;
  onClose: () => void;
  boardTitle: string;
  canInvite: boolean;
  members: ShareMember[];
  onShare: (email: string, role: Role) => Promise<{ ok: boolean; error?: string }>;
}

const initials = (name: string): string =>
  name
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

const MEMBER_COLORS = ["var(--band-violet)", "var(--band-teal)", "var(--band-coral)", "var(--band-sky)", "var(--band-pink)", "var(--band-sun)"];

export function ShareDialog({
  open,
  onClose,
  boardTitle,
  canInvite,
  members,
  onShare,
}: ShareDialogProps) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("editor");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!open) return null;

  const invite = () => {
    const trimmed = email.trim();
    if (!trimmed) return;
    setMessage(null);
    startTransition(async () => {
      const result = await onShare(trimmed, role);
      setMessage(result.ok ? `Invited ${trimmed} as ${role}.` : (result.error ?? "Failed."));
      if (result.ok) setEmail("");
    });
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-[rgba(22,17,8,.55)] p-5"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Share this board"
        className="flex max-h-[86dvh] w-[470px] max-w-full flex-col overflow-hidden rounded-[18px] border-[2.5px] border-[var(--line)] bg-[var(--surface)] shadow-[6px_6px_0_var(--shadow)]"
        style={{ animation: "ccpop .18s ease" }}
      >
        <div className="flex flex-none items-baseline gap-2 border-b-[2.5px] border-[var(--line)] bg-[var(--band-sky)] px-3.5 py-[11px]">
          <div className="font-display text-[15.5px] font-semibold text-[#1c1a17]">
            Share this board
          </div>
          <div className="truncate font-sans text-[11px] text-[#1c1a17] opacity-75">
            {boardTitle}
          </div>
          <button
            onClick={onClose}
            aria-label="Close share dialog"
            className="ml-auto flex h-6 w-6 flex-none items-center justify-center self-center rounded-[7px] border-[1.5px] border-[var(--line)] bg-[var(--paper)] text-xs text-[#1c1a17]"
          >
            ✕
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto p-3.5">
          {canInvite ? (
            <div>
              <div className="mb-1.5 font-mono text-[9px] font-bold uppercase tracking-[.6px] text-[var(--ink-faint)]">
                Invite someone
              </div>
              <div className="flex gap-1.5">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && invite()}
                  placeholder="name@team.com"
                  aria-label="Email to invite"
                  className="min-w-0 flex-1 rounded-[9px] border-2 border-[var(--line)] bg-[var(--surface)] px-2.5 py-[7px] font-sans text-xs font-semibold text-[var(--ink)] outline-none"
                />
                <button
                  onClick={invite}
                  disabled={pending}
                  className="cc-press flex-none rounded-[9px] border-2 border-[var(--line)] bg-[var(--sun)] px-[13px] py-[7px] font-display text-xs font-semibold text-[#1c1a17] shadow-[2px_2px_0_var(--shadow)] disabled:opacity-60"
                >
                  {pending ? "…" : "Invite"}
                </button>
              </div>
              <div className="mt-1.5 flex gap-1">
                {(["editor", "viewer"] as const).map((r) => (
                  <button
                    key={r}
                    onClick={() => setRole(r)}
                    className="rounded-[7px] border-[1.5px] border-[var(--line)] px-3 py-1 font-sans text-[10.5px] font-semibold text-[#1c1a17]"
                    style={{ background: role === r ? "var(--band-teal)" : "var(--seg-off, var(--surface-2))" }}
                  >
                    {r === "editor" ? "Can edit" : "View only"}
                  </button>
                ))}
              </div>
              {message && (
                <div className="mt-2 font-sans text-[11.5px] text-[var(--ink-soft)]">
                  {message}
                </div>
              )}
              <div className="mt-2 font-mono text-[9.5px] text-[var(--ink-faint)]">
                They must have signed in to CollabCanvas once before.
              </div>
            </div>
          ) : (
            <div className="rounded-[11px] border-2 border-dashed border-[var(--line)] px-3 py-2.5 font-sans text-[11.5px] text-[var(--ink-soft)]">
              You&apos;re viewing this board — only editors can invite people.
            </div>
          )}

          <div>
            <div className="mb-1.5 font-mono text-[9px] font-bold uppercase tracking-[.6px] text-[var(--ink-faint)]">
              On this board · {members.length}
            </div>
            <div className="flex flex-col gap-[7px]">
              {members.map((m, i) => (
                <div
                  key={m.email}
                  className="flex items-center gap-[9px] rounded-[11px] border-2 border-[var(--line)] px-[9px] py-[7px]"
                >
                  <div
                    className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-full border-2 border-[var(--chip-line)] font-sans text-[10px] font-bold text-[#1c1a17]"
                    style={{ background: MEMBER_COLORS[i % MEMBER_COLORS.length] }}
                  >
                    {initials(m.name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-[5px]">
                      <span className="font-sans text-[12.5px] font-semibold text-[var(--ink)]">
                        {m.name}
                      </span>
                      {m.isYou && (
                        <span className="rounded-full border-[1.5px] border-[var(--chip-line)] bg-[var(--sun)] px-1.5 py-px font-sans text-[8.5px] font-bold text-[#1c1a17]">
                          YOU
                        </span>
                      )}
                    </div>
                    <div className="truncate font-mono text-[10px] text-[var(--ink-faint)]">
                      {m.email}
                    </div>
                  </div>
                  <span
                    className={`flex-none whitespace-nowrap rounded-full border-[1.5px] px-2 py-0.5 font-sans text-[9.5px] font-bold ${
                      m.role === "editor"
                        ? "border-[var(--chip-line)] bg-[var(--band-teal)] text-[#1c1a17]"
                        : "border-dashed border-[var(--line)] bg-[var(--surface-2)] text-[var(--ink-soft)]"
                    }`}
                  >
                    {m.role === "editor" ? "Editor" : "Viewer"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
