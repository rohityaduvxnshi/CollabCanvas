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
  issueVerificationCode,
  passwordLogin,
  signUpEmail,
  verifyWithCode,
} from "../web/lib/emailAuth";
import { hashPassword, verifyPassword } from "../web/lib/password";

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

  origLog(`\nphase7: ${passed}/${passed + failed} checks passed`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
