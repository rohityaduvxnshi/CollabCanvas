/**
 * Phase 7 headless email-auth harness — exercises web/lib/emailAuth.ts
 * directly against the local dev Postgres (no web server needed).
 *
 * Codes are stored sha256-hashed, so the harness captures the plaintext from
 * the dev-mode mail fallback (console.log) instead of reading the DB.
 *
 * Run:  npx tsx scripts/phase7-emailauth.ts
 */

process.loadEnvFile("packages/db/.env");
delete process.env.RESEND_API_KEY; // force the console-log mail path

import { getPrisma } from "../packages/db/src/index";
import {
  checkEmail,
  issueVerificationCode,
  passwordLogin,
  setPasswordAndVerify,
  signUpEmail,
  startEmailVerification,
  verifyWithCode,
} from "../web/lib/emailAuth";
import { hashPassword, verifyPassword } from "../web/lib/password";
import { LIMITS } from "@collabcanvas/shared";

const EMAIL = "phase7@test.local";
const OAUTH_EMAIL = "phase7-oauth@test.local";
const PASSWORD = "correct horse battery";

// Capture mailed codes from the dev fallback log line.
let lastCode = "";
const origLog = console.log;
console.log = (...args: unknown[]) => {
  const m = /verification code for \S+: (\d{6})/.exec(args.join(" "));
  if (m) lastCode = m[1];
  origLog(...args);
};

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean) {
  origLog(`${ok ? "✅" : "❌"} ${name}`);
  ok ? passed++ : failed++;
}

async function tokenCount(email: string): Promise<number> {
  return getPrisma().verificationToken.count({ where: { identifier: email } });
}

async function main() {
  const prisma = getPrisma();

  // Clean slate for idempotent reruns.
  for (const email of [EMAIL, OAUTH_EMAIL]) {
    await prisma.verificationToken.deleteMany({ where: { identifier: email } });
    const u = await prisma.user.findUnique({ where: { email } });
    if (u) {
      await prisma.account.deleteMany({ where: { userId: u.id } });
      await prisma.user.delete({ where: { id: u.id } });
    }
  }

  // -- password.ts sanity -----------------------------------------------
  const stored = await hashPassword(PASSWORD);
  check("hash/verify round-trip", await verifyPassword(PASSWORD, stored));
  check("wrong password rejected", !(await verifyPassword("nope", stored)));
  check("garbage hash rejected (no KDF run)", !(await verifyPassword(PASSWORD, "not-a-hash")));

  // -- signup ------------------------------------------------------------
  const su = await signUpEmail(EMAIL, PASSWORD);
  check("signup creates account", su.ok);
  const code1 = lastCode;
  check("signup mailed a 6-digit code", /^\d{6}$/.test(code1));
  const row = await prisma.verificationToken.findFirst({
    where: { identifier: EMAIL },
  });
  check("code stored hashed, not plaintext", !!row && row.token !== code1);
  check(
    "password login before verify → unverified",
    (await passwordLogin(EMAIL, PASSWORD)) === "unverified",
  );

  // -- verification requires code AND password ---------------------------
  const wrong = code1 === "000000" ? "000001" : "000000";
  check(
    "wrong code rejected",
    (await verifyWithCode(EMAIL, PASSWORD, wrong)) === null,
  );
  check(
    "wrong password rejected (code correct)",
    (await verifyWithCode(EMAIL, "wrong password", code1)) === null,
  );
  check(
    "wrong password did NOT consume the code",
    (await tokenCount(EMAIL)) === 1,
  );
  const verified = await verifyWithCode(EMAIL, PASSWORD, code1);
  check("code+password verifies", verified?.email === EMAIL);
  check(
    "code is one-shot (replay rejected)",
    (await verifyWithCode(EMAIL, PASSWORD, code1)) === null,
  );
  const dbUser = await prisma.user.findUnique({ where: { email: EMAIL } });
  check("emailVerified stamped", !!dbUser?.emailVerified);

  // -- password login ----------------------------------------------------
  const login = await passwordLogin(EMAIL, PASSWORD);
  check(
    "password login after verify",
    typeof login === "object" && login?.email === EMAIL,
  );
  check(
    "wrong password login rejected",
    (await passwordLogin(EMAIL, "wrongwrong")) === null,
  );

  // -- verified accounts are not overwritable ----------------------------
  const takeover = await signUpEmail(EMAIL, "attacker-password");
  check("re-signup on verified account rejected", !takeover.ok);
  check(
    "old password still works after rejected takeover",
    typeof (await passwordLogin(EMAIL, PASSWORD)) === "object",
  );

  // -- OAuth-linked accounts are not overwritable or code-signable -------
  const oauthUser = await prisma.user.create({
    data: {
      email: OAUTH_EMAIL,
      name: "OAuth Person",
      accounts: {
        create: {
          type: "oauth",
          provider: "github",
          providerAccountId: "phase7-gh-123",
        },
      },
    },
  });
  const oauthTakeover = await signUpEmail(OAUTH_EMAIL, "attacker-password");
  check(
    "signup on OAuth-linked (unverified) account rejected",
    !oauthTakeover.ok,
  );
  check(
    "no code path for accounts without a password",
    (await verifyWithCode(OAUTH_EMAIL, "whatever", "123456")) === null,
  );
  check(
    "OAuth user's passwordHash untouched",
    (await prisma.user.findUnique({ where: { id: oauthUser.id } }))
      ?.passwordHash === null,
  );

  // -- pre-verification takeover is closed --------------------------------
  // Attacker overwrites an unverified signup's password; the fresh code
  // mailed to the victim must NOT verify with the victim's own password.
  const victim = "phase7-victim@test.local";
  await prisma.verificationToken.deleteMany({ where: { identifier: victim } });
  await prisma.user.deleteMany({ where: { email: victim } });
  await signUpEmail(victim, "victim-password");
  await signUpEmail(victim, "attacker-password"); // unverified → overwrite allowed
  const attackerCode = lastCode;
  check(
    "victim's password + attacker-era code fails (takeover closed)",
    (await verifyWithCode(victim, "victim-password", attackerCode)) === null,
  );
  check(
    "failed takeover-verify did not consume the code",
    (await tokenCount(victim)) === 1,
  );
  // Victim recovers by re-signing-up with their own password.
  await signUpEmail(victim, "victim-password");
  const recoveryCode = lastCode;
  check(
    "victim re-signup + fresh code verifies",
    (await verifyWithCode(victim, "victim-password", recoveryCode))?.email ===
      victim,
  );

  // -- expiry ------------------------------------------------------------
  check("resend issues a code for a known user", await issueVerificationCode(EMAIL));
  const expiredCode = lastCode;
  await prisma.verificationToken.updateMany({
    where: { identifier: EMAIL },
    data: { expires: new Date(Date.now() - 1000) },
  });
  check(
    "expired code rejected",
    (await verifyWithCode(EMAIL, PASSWORD, expiredCode)) === null,
  );
  check("expired code was still consumed", (await tokenCount(EMAIL)) === 0);

  // -- unknown emails never get mail -------------------------------------
  check(
    "no code issued for unknown email",
    !(await issueVerificationCode("stranger@test.local")),
  );

  // -- email-first flow (2026-07-05): checkEmail / startEmailVerification /
  //    setPasswordAndVerify (code-first: verify email, THEN set password) ---
  const EF = "phase7-ef@test.local";
  await prisma.verificationToken.deleteMany({ where: { identifier: EF } });
  await prisma.user.deleteMany({ where: { email: EF } });

  check("checkEmail: unknown → new", (await checkEmail(EF)) === "new");
  check("checkEmail: malformed → invalid", (await checkEmail("nope")) === "invalid");
  check("checkEmail: verified account → known", (await checkEmail(EMAIL)) === "known");
  check("checkEmail: OAuth account → oauth", (await checkEmail(OAUTH_EMAIL)) === "oauth");

  const startNew = await startEmailVerification(EF);
  check("startEmailVerification: new email ok", startNew.ok);
  const efCode = lastCode;
  check("startEmailVerification mailed a 6-digit code", /^\d{6}$/.test(efCode));
  const efRow = await prisma.user.findUnique({ where: { email: EF } });
  check(
    "creates a PASSWORDLESS, unverified row",
    !!efRow && efRow.passwordHash === null && efRow.emailVerified === null,
  );
  check(
    "startEmailVerification refuses a verified account",
    !(await startEmailVerification(EMAIL)).ok,
  );

  const efWrong = efCode === "000000" ? "000001" : "000000";
  check(
    "setPasswordAndVerify: wrong code → null",
    (await setPasswordAndVerify(EF, efWrong, "new-password-123")) === null,
  );
  check("wrong code did NOT consume the code", (await tokenCount(EF)) === 1);
  check(
    "setPasswordAndVerify: short password → null (no consume)",
    (await setPasswordAndVerify(EF, efCode, "short")) === null &&
      (await tokenCount(EF)) === 1,
  );

  const efUser = await setPasswordAndVerify(EF, efCode, "new-password-123");
  check("code sets password + verifies the email", efUser?.email === EF);
  check(
    "new account can now password-login",
    typeof (await passwordLogin(EF, "new-password-123")) === "object",
  );
  check(
    "setup code is one-shot (replay → null)",
    (await setPasswordAndVerify(EF, efCode, "another-pass-9")) === null,
  );
  check("checkEmail after setup → known", (await checkEmail(EF)) === "known");

  // Defense: an already-verified account can't be re-setup even WITH a code.
  await issueVerificationCode(EF);
  const efFresh = lastCode;
  check(
    "setPasswordAndVerify refuses an already-verified account",
    (await setPasswordAndVerify(EF, efFresh, "hacker-pass-1")) === null,
  );
  check(
    "verified account's password unchanged after refused re-setup",
    typeof (await passwordLogin(EF, "new-password-123")) === "object",
  );

  // -- review hardening (2026-07-05) -------------------------------------
  // (a) verified OAuth accounts (Google stamps emailVerified) route to oauth,
  //     not to a "wrong password" dead end; (b) setPasswordAndVerify refuses
  //     ANY OAuth-linked account even if a code exists (defense in depth);
  //     (c) over-long passwords are rejected before the scrypt/consume.
  const GOOG = "phase7-goog@test.local";
  await prisma.verificationToken.deleteMany({ where: { identifier: GOOG } });
  await prisma.user.deleteMany({ where: { email: GOOG } });
  const goog = await prisma.user.create({
    data: {
      email: GOOG,
      emailVerified: new Date(), // provider-stamped, but no password
      accounts: {
        create: { type: "oauth", provider: "google", providerAccountId: "phase7-goog-1" },
      },
    },
  });
  check("checkEmail: verified OAuth (no password) → oauth, not known", (await checkEmail(GOOG)) === "oauth");
  await issueVerificationCode(GOOG); // a code exists for an OAuth email
  check(
    "setPasswordAndVerify refuses an OAuth-linked account (defense)",
    (await setPasswordAndVerify(GOOG, lastCode, "attacker-pass-1")) === null,
  );
  check(
    "OAuth account still passwordless after refused setup",
    (await prisma.user.findUnique({ where: { id: goog.id } }))?.passwordHash === null,
  );

  const PWMAX = "phase7-pwmax@test.local";
  await prisma.verificationToken.deleteMany({ where: { identifier: PWMAX } });
  await prisma.user.deleteMany({ where: { email: PWMAX } });
  await startEmailVerification(PWMAX);
  const pwmaxCode = lastCode;
  check(
    "over-long password → null AND code not consumed",
    (await setPasswordAndVerify(PWMAX, pwmaxCode, "x".repeat(LIMITS.passwordMax + 1))) === null &&
      (await tokenCount(PWMAX)) === 1,
  );

  origLog(`\nphase7: ${passed}/${passed + failed} checks passed`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
