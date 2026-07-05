/**
 * Email+password auth core (Phase 7). Plain functions over Prisma so the
 * phase7 harness can exercise them directly (no "server-only" import here —
 * same constraint as the other harness-visible modules).
 *
 * Security model (hardened per Ph7 adversarial review):
 * - A password sign-in requires a VERIFIED email; verification consumes a
 *   one-time 6-digit code mailed to the address (stored sha256-hashed).
 * - Verification requires the CODE AND THE PASSWORD — proving the mailbox
 *   owner also set the password. This closes the pre-verification takeover:
 *   an attacker who overwrites an unverified account's password can't get
 *   the mailed code, and the victim entering that code with their own (now
 *   replaced) password fails harmlessly without consuming it.
 * - Sign-up may overwrite an UNVERIFIED, OAuth-less account (self-service
 *   typo recovery); verified accounts and accounts with linked OAuth
 *   accounts are never overwritable (OAuth users have emailVerified=null —
 *   the installed GitHub/Google profile() mappings never set it).
 */

import { createHash, randomInt } from "node:crypto";
import { getPrisma } from "@collabcanvas/db";
import { LIMITS } from "@collabcanvas/shared";
import { hashPassword, verifyPassword } from "./password";
import { sendVerificationCode } from "./mail";

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const PASSWORD_MIN = LIMITS.passwordMin;
const CODE_TTL_MS = 15 * 60 * 1000;

/** Codes are stored hashed — a DB dump must not contain sign-in secrets. */
const hashCode = (code: string): string =>
  createHash("sha256").update(code).digest("hex");

export type AuthUser = {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
};

/** Create (or reclaim an unverified, OAuth-less) email account and mail a code. */
export async function signUpEmail(
  email: string,
  password: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const prisma = getPrisma();
  const existing = await prisma.user.findUnique({
    where: { email },
    include: { accounts: { select: { id: true } } },
  });
  if (existing && (existing.emailVerified || existing.accounts.length > 0)) {
    return {
      ok: false,
      error: "An account with this email already exists — sign in instead.",
    };
  }
  const passwordHash = await hashPassword(password);
  await prisma.user.upsert({
    where: { email },
    update: { passwordHash },
    create: { email, passwordHash },
  });
  await issueVerificationCode(email);
  return { ok: true };
}

/** Mail a fresh 6-digit code (replaces any outstanding one). User must exist. */
export async function issueVerificationCode(email: string): Promise<boolean> {
  const prisma = getPrisma();
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return false; // don't mail strangers
  const code = String(randomInt(100_000, 1_000_000));
  await prisma.$transaction([
    prisma.verificationToken.deleteMany({ where: { identifier: email } }),
    prisma.verificationToken.create({
      data: {
        identifier: email,
        token: hashCode(code),
        expires: new Date(Date.now() + CODE_TTL_MS),
      },
    }),
  ]);
  await sendVerificationCode(email, code);
  return true;
}

/**
 * Verify an email with its code AND password. Password is checked first so a
 * wrong password never burns the code; a matching code is then consumed
 * atomically (delete-returns-row — concurrent submits can't double-spend),
 * whether or not it has expired.
 */
export async function verifyWithCode(
  email: string,
  password: string,
  code: string,
): Promise<AuthUser | null> {
  const prisma = getPrisma();
  const user = await prisma.user.findUnique({ where: { email } });
  // Code sign-in is only for password accounts — never a magic-link backdoor
  // around an OAuth account's own 2FA (Ph7 review).
  if (!user?.passwordHash) return null;
  if (!(await verifyPassword(password, user.passwordHash))) return null;
  const row = await prisma.verificationToken
    .delete({
      where: {
        identifier_token: { identifier: email, token: hashCode(code) },
      },
    })
    .catch(() => null);
  if (!row || row.expires < new Date()) return null;
  try {
    return await prisma.user.update({
      where: { email },
      data: { emailVerified: new Date() },
    });
  } catch {
    return null; // user row vanished — treat as invalid code
  }
}

/** Password check; "unverified" means correct password but email not confirmed. */
export async function passwordLogin(
  email: string,
  password: string,
): Promise<AuthUser | "unverified" | null> {
  const prisma = getPrisma();
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user?.passwordHash) return null;
  if (!(await verifyPassword(password, user.passwordHash))) return null;
  if (!user.emailVerified) return "unverified";
  return user;
}

// ---------------------------------------------------------------------------
// Email-first flow (2026-07-05): one email box decides the next step, so we
// never ask for a password before we know the account exists. New users verify
// the email with a code and set their password AFTER (code-first), which is
// still takeover-safe: the code only reaches the mailbox owner, and only the
// code-holder can set the password. checkEmail routes verified/OAuth accounts
// AWAY from the setup path, and setPasswordAndVerify refuses verified accounts.
// ---------------------------------------------------------------------------

export type EmailStatus = "known" | "new" | "oauth" | "invalid";

/** Which step the email-first form should show next for this address. */
export async function checkEmail(email: string): Promise<EmailStatus> {
  if (!EMAIL_RE.test(email)) return "invalid";
  const user = await getPrisma().user.findUnique({
    where: { email },
    include: { accounts: { select: { id: true } } },
  });
  if (!user) return "new";
  // OAuth-only account (no password) → OAuth, even if the provider stamped
  // emailVerified (Google does) — otherwise they'd hit a "wrong password" wall.
  if (user.accounts.length > 0 && !user.passwordHash) return "oauth";
  if (user.emailVerified) return "known"; // real password account → sign-in
  return "new"; // unverified password row (or none) → code-first setup
}

/**
 * Begin (or resume) email verification for a NOT-yet-established account:
 * ensure a passwordless user row exists, then mail a fresh code. Refuses
 * verified/OAuth accounts (they own the address already — must sign in).
 *
 * ponytail: a passwordless row is created on first "continue" for a new email;
 * abandoned ones are harmless (unverified, no password) — a periodic cleanup
 * sweep is the follow-up, same as the orphan-attachment note. Abuse (mailing
 * strangers) is bounded by the per-email rate limit at the action layer; a
 * per-IP limit is the harder follow-up (in-process limiter, single node).
 */
export async function startEmailVerification(
  email: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!EMAIL_RE.test(email)) {
    return { ok: false, error: "That doesn't look like an email address." };
  }
  const prisma = getPrisma();
  const existing = await prisma.user.findUnique({
    where: { email },
    include: { accounts: { select: { id: true } } },
  });
  if (existing && (existing.emailVerified || existing.accounts.length > 0)) {
    return {
      ok: false,
      error: "This email already has an account — sign in instead.",
    };
  }
  await prisma.user.upsert({ where: { email }, update: {}, create: { email } });
  await issueVerificationCode(email);
  return { ok: true };
}

/**
 * Consume a code and SET the account's password (code-first setup). Unlike
 * verifyWithCode (which checks an already-set password), the code is the sole
 * proof of ownership here, so it MUST be valid. Refuses an already-verified
 * account (defense in depth — the UI never routes those here).
 */
export async function setPasswordAndVerify(
  email: string,
  code: string,
  password: string,
): Promise<AuthUser | null> {
  if (
    password.length < PASSWORD_MIN ||
    password.length > LIMITS.passwordMax ||
    !/^\d{6}$/.test(code)
  ) {
    return null;
  }
  const prisma = getPrisma();
  const user = await prisma.user.findUnique({
    where: { email },
    include: { accounts: { select: { id: true } } },
  });
  if (!user) return null;
  // Established (verified) OR OAuth-linked → must sign in, never re-setup. This
  // guard is the sole thing preventing an OAuth-account takeover, so it's made
  // explicit here (defense in depth) rather than relying on "no code is ever
  // minted for those emails" upstream.
  if (user.emailVerified || user.accounts.length > 0) return null;
  // Consume the code atomically (delete-returns-row → no double-spend), then
  // check freshness — mirrors verifyWithCode so an expired code can't be reused.
  const row = await prisma.verificationToken
    .delete({
      where: { identifier_token: { identifier: email, token: hashCode(code) } },
    })
    .catch(() => null);
  if (!row || row.expires < new Date()) return null;
  const passwordHash = await hashPassword(password);
  try {
    return await prisma.user.update({
      where: { email },
      data: { passwordHash, emailVerified: new Date() },
    });
  } catch {
    return null; // user row vanished — treat as invalid
  }
}
