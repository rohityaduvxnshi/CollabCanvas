/**
 * Auth.js (NextAuth v5) configuration: GitHub + Google OAuth, Prisma adapter,
 * database sessions in Postgres. Server-side session access via `auth()`.
 */

import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { getPrisma } from "@collabcanvas/db";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(getPrisma()),
  providers: [GitHub, Google],
  callbacks: {
    // Database sessions: expose the user id to server code (ws-token, boards).
    session({ session, user }) {
      session.user.id = user.id;
      return session;
    },
  },
});
