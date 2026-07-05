"use client";

/**
 * Email-first auth (2026-07-05). One progressive form: an email box decides the
 * next step (returning → password, new → code + set password), OAuth below.
 * Pure presentational + server-action dispatch — no Yjs, no fetch.
 */

import { useActionState } from "react";
import { LIMITS } from "@collabcanvas/shared";
import {
  completeProfileAction,
  emailFirstAction,
  signInGitHubAction,
  signInGoogleAction,
  type AuthFormState,
} from "@/lib/actions";

const INPUT =
  "w-full rounded-[10px] border-2 border-[var(--line)] bg-[var(--surface)] px-[11px] py-2 font-sans text-[13px] font-semibold text-[var(--ink)] outline-none placeholder:text-[var(--ink-faint)]";
const PRIMARY = "cc-btn w-full bg-[var(--ink)] text-[var(--app)]";
const SECONDARY = "cc-btn w-full bg-[var(--surface)] text-[var(--ink)]";

function ErrorLine({ state }: { state: AuthFormState }) {
  if (!state.error) return null;
  return (
    <p className="m-0 rounded-[9px] border-2 border-[var(--line)] bg-[var(--band-coral)] px-3 py-1.5 font-sans text-[12px] font-semibold text-[#1c1a17]">
      {state.error}
    </p>
  );
}

/** The whole login/signup flow: email → (password | code + set password). */
export function EmailFirstForm() {
  const [state, dispatch, pending] = useActionState(
    emailFirstAction,
    { step: "email" } as AuthFormState,
  );
  const step = state.step ?? "email";
  const email = state.email ?? "";

  return (
    <div className="flex w-72 flex-col gap-3">
      <form action={dispatch} className="flex flex-col gap-2.5">
        <input type="hidden" name="step" value={step} />

        {step === "email" ? (
          <input
            className={INPUT}
            name="email"
            type="email"
            required
            autoFocus
            autoComplete="email"
            placeholder="you@example.com"
            aria-label="Email"
            defaultValue={email}
            key={email || "email"} // survive React 19's post-action form reset
          />
        ) : (
          <>
            <div className="flex items-center justify-between rounded-[10px] border-2 border-[var(--line)] bg-[var(--surface-2)] px-[11px] py-2">
              <span className="truncate font-sans text-[12.5px] font-semibold text-[var(--ink)]">
                {email}
              </span>
              <button
                type="submit"
                name="intent"
                value="change"
                formNoValidate
                className="ml-2 shrink-0 font-sans text-[11px] font-semibold text-[var(--ink-soft)] underline"
              >
                change
              </button>
            </div>
            <input type="hidden" name="email" value={email} />
          </>
        )}

        {step === "setup" && (
          <p className="m-0 rounded-[9px] border-2 border-[var(--line)] bg-[var(--band-teal)] px-3 py-1.5 text-left font-sans text-[12px] font-semibold text-[#1c1a17]">
            We emailed a 6-digit code to you. Enter it and choose a password.
          </p>
        )}

        {step === "password" && (
          <input
            className={INPUT}
            name="password"
            type="password"
            required
            autoFocus
            autoComplete="current-password"
            placeholder="Your password"
            aria-label="Password"
          />
        )}

        {step === "setup" && (
          <>
            <input
              className={`${INPUT} text-center font-mono text-lg tracking-[0.35em]`}
              name="code"
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              required
              autoFocus
              autoComplete="one-time-code"
              placeholder="••••••"
              aria-label="6-digit verification code"
            />
            <input
              className={INPUT}
              name="password"
              type="password"
              required
              minLength={LIMITS.passwordMin}
              maxLength={LIMITS.passwordMax}
              autoComplete="new-password"
              placeholder={`New password (${LIMITS.passwordMin}+ characters)`}
              aria-label="New password"
            />
          </>
        )}

        {step === "oauth" && (
          <p className="m-0 rounded-[9px] border-2 border-[var(--line)] bg-[var(--band-sun)] px-3 py-2 text-left font-sans text-[12px] font-semibold text-[#1c1a17]">
            This email is linked to a Google or GitHub account — use a button
            below to sign in.
          </p>
        )}

        <ErrorLine state={state} />
        {state.ok && step === "setup" ? (
          <p className="m-0 font-sans text-[12px] font-semibold text-[var(--ink-soft)]">
            A fresh code is on its way.
          </p>
        ) : null}

        {step === "email" && (
          <button className={PRIMARY} disabled={pending}>
            {pending ? "Checking…" : "Continue"}
          </button>
        )}
        {step === "password" && (
          <button className={PRIMARY} disabled={pending}>
            {pending ? "Signing in…" : "Sign in"}
          </button>
        )}
        {step === "setup" && (
          <>
            <button className={PRIMARY} disabled={pending}>
              {pending ? "Creating…" : "Create account"}
            </button>
            <button
              className={SECONDARY}
              name="intent"
              value="resend"
              formNoValidate
              disabled={pending}
            >
              {pending ? "…" : "Resend code"}
            </button>
          </>
        )}
      </form>

      {step === "email" || step === "oauth" ? (
        <>
          <div className="flex items-center gap-2 text-[var(--ink-faint)]">
            <span className="h-px flex-1 bg-[var(--line)]" />
            <span className="font-sans text-[11px] font-semibold">or</span>
            <span className="h-px flex-1 bg-[var(--line)]" />
          </div>
          <form action={signInGitHubAction}>
            <button className="cc-btn w-full bg-[var(--ink)] text-[var(--app)]">
              Continue with GitHub
            </button>
          </form>
          <form action={signInGoogleAction}>
            <button className="cc-btn w-full bg-[var(--surface)] text-[var(--ink)]">
              Continue with Google
            </button>
          </form>
        </>
      ) : null}
    </div>
  );
}

export function ProfileForm({
  initialName,
  initialBio,
}: {
  initialName: string;
  initialBio: string;
}) {
  const [state, dispatch, pending] = useActionState(
    completeProfileAction,
    {} as AuthFormState,
  );

  return (
    <form action={dispatch} className="flex w-72 flex-col gap-2.5">
      <input
        className={INPUT}
        name="name"
        required
        maxLength={LIMITS.userName}
        defaultValue={initialName}
        placeholder="Your name"
        aria-label="Name"
      />
      <textarea
        className={`${INPUT} min-h-20 resize-none`}
        name="bio"
        maxLength={LIMITS.userBio}
        defaultValue={initialBio}
        placeholder="A line about you (optional)"
        aria-label="Short bio"
      />
      <ErrorLine state={state} />
      <button className={PRIMARY} disabled={pending}>
        {pending ? "Saving…" : "Let's go"}
      </button>
    </form>
  );
}
