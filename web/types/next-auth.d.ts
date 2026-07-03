import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  /** Database sessions + our session callback always expose the user id. */
  interface Session {
    user: { id: string } & DefaultSession["user"];
  }
}
