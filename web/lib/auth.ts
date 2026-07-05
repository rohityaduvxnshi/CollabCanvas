/**
 * Auth.js (NextAuth v5) configuration: GitHub + Google OAuth (buttons kept,
 * creds mapped later) + email/password Credentials (Phase 7), Prisma adapter.
 *
 * Sessions are JWT — an Auth.js constraint: the Credentials provider only
 * works with JWT sessions. OAuth users are still persisted via the adapter.
 * Accepted limitation (documented): JWTs can't be revoked server-side;
 * board access is still re-checked per request via membership queries.
 */

import NextAuth, { CredentialsSignin } from "next-auth";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { getPrisma } from "@collabcanvas/db";
import { passwordLogin, setPasswordAndVerify } from "./emailAuth";
import { rateLimit } from "./rateLimit";

/** Correct password, unconfirmed email — the action routes this to /verify. */
export class UnverifiedEmail extends CredentialsSignin {
  code = "unverified";
}

/** Bucket exhausted — surfaced honestly instead of "invalid password". */
export class RateLimited extends CredentialsSignin {
  code = "rate";
}

export const { handlers, auth, signIn, signOut, unstable_update } = NextAuth({
  adapter: PrismaAdapter(getPrisma()),
  session: { strategy: "jwt" },
  providers: [
    GitHub,
    Google,
    Credentials({
      credentials: { email: {}, password: {}, code: {}, mode: {} },
      async authorize(creds) {
        const email = String(creds?.email ?? "")
          .trim()
          .toLowerCase();
        const password = String(creds?.password ?? "");
        if (!email || !password) return null;
        // This route is reachable directly (POST /api/auth/callback/credentials),
        // so the brute-force guards live HERE, not in the server actions.
        // Separate buckets: fumbled passwords must not lock out a valid code.
        const mode = String(creds?.mode ?? "");
        let user = null;
        if (mode === "setup") {
          // Code-first account setup (email-first flow): the mailed code is the
          // proof of ownership; the password is SET now. setPasswordAndVerify
          // refuses already-verified accounts, so this can't reset a real login.
          if (!rateLimit(`cred-code:${email}`, 10, 10 * 60_000)) {
            throw new RateLimited();
          }
          user = await setPasswordAndVerify(email, String(creds?.code ?? ""), password);
        } else {
          if (!rateLimit(`cred-pw:${email}`, 10, 60_000)) {
            throw new RateLimited();
          }
          const result = await passwordLogin(email, password);
          if (result === "unverified") throw new UnverifiedEmail();
          user = result;
        }
        if (!user) return null;
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
        };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user, trigger, session }) {
      // First sign-in: persist the DB user id into the token.
      if (user?.id) token.sub = user.id;
      // unstable_update() from completeProfileAction — without this the JWT
      // keeps name=null forever and presence broadcasts the raw email.
      if (trigger === "update" && session?.user) {
        token.name = session.user.name ?? token.name;
      }
      return token;
    },
    session({ session, token }) {
      if (token.sub) session.user.id = token.sub;
      return session;
    },
  },
});
