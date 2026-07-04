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
