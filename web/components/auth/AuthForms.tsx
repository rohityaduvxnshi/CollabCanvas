"use client";

/**
 * Phase 7 email-auth forms (client): sign in / sign up, verify code, intro
 * details. Pure presentational + server-action dispatch — no Yjs, no fetch.
 */

import { useActionState } from "react";
import { LIMITS } from "@collabcanvas/shared";
import {
  completeProfileAction,
  emailAuthAction,
  resendCodeAction,
  verifyCodeAction,
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

/** One form, one action — the submit button picks the intent. */
export function EmailAuthForm() {
  const [state, dispatch, pending] = useActionState(
    emailAuthAction,
    {} as AuthFormState,
  );

  return (
    <form action={dispatch} className="flex w-72 flex-col gap-2.5">
      <input
        className={INPUT}
        name="email"
        type="email"
        required
        autoComplete="email"
        placeholder="you@example.com"
        aria-label="Email"
        defaultValue={state.email ?? ""}
        key={state.email ?? "email"} // survive React 19's post-action form reset
      />
      <input
        className={INPUT}
        name="password"
        type="password"
        required
        minLength={LIMITS.passwordMin}
        autoComplete="current-password"
        placeholder={`Password (${LIMITS.passwordMin}+ characters)`}
        aria-label="Password"
      />
      <ErrorLine state={state} />
      <button
        className={PRIMARY}
        name="intent"
        value="signin"
        disabled={pending}
      >
        {pending ? "Working…" : "Sign in"}
      </button>
      <button
        className={SECONDARY}
        name="intent"
        value="signup"
        disabled={pending}
      >
        Create account
      </button>
    </form>
  );
}

export function VerifyCodeForm({ email }: { email: string }) {
  const [verifyState, verifyDispatch, verifyPending] = useActionState(
    verifyCodeAction,
    {} as AuthFormState,
  );
  const [resendState, resendDispatch, resendPending] = useActionState(
    resendCodeAction,
    {} as AuthFormState,
  );

  return (
    <form className="flex w-72 flex-col gap-2.5">
      <input type="hidden" name="email" value={email} />
      <input
        className={INPUT}
        name="password"
        type="password"
        required
        autoComplete="current-password"
        placeholder="Your password"
        aria-label="Password"
      />
      <input
        className={`${INPUT} text-center font-mono text-lg tracking-[0.35em]`}
        name="code"
        inputMode="numeric"
        pattern="\d{6}"
        maxLength={6}
        required
        autoComplete="one-time-code"
        placeholder="••••••"
        aria-label="6-digit verification code"
      />
      <ErrorLine state={verifyState} />
      <ErrorLine state={resendState} />
      {resendState.ok ? (
        <p className="m-0 font-sans text-[12px] font-semibold text-[var(--ink-soft)]">
          A fresh code is on its way.
        </p>
      ) : null}
      <button
        className={PRIMARY}
        formAction={verifyDispatch}
        disabled={verifyPending}
      >
        {verifyPending ? "Checking…" : "Verify"}
      </button>
      <button
        className={SECONDARY}
        formAction={resendDispatch}
        formNoValidate
        disabled={resendPending}
      >
        {resendPending ? "Sending…" : "Resend code"}
      </button>
    </form>
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
