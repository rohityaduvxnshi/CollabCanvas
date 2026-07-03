"use server";

/** Server actions: the mutation seam between client components and lib/boards. */

import { redirect } from "next/navigation";
import { auth, signIn, signOut } from "./auth";
import { createBoard, getMembership, shareBoard } from "./boards";
import { rateLimit } from "./rateLimit";
import { LIMITS, type Role } from "@collabcanvas/shared";

/** Good-enough email shape check — the real validation is that the invitee
 *  must already have a User row (shareBoard checks). */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function signInAction(provider: "github" | "google") {
  await signIn(provider, { redirectTo: "/" });
}

export async function signOutAction() {
  await signOut({ redirectTo: "/" });
}

export async function createBoardAction(title: string): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  if (!rateLimit(`create-board:${session.user.id}`, 20, 60_000)) redirect("/");
  const boardId = await createBoard(
    session.user.id,
    title.trim().slice(0, LIMITS.boardTitle),
  );
  redirect(`/boards/${boardId}`);
}

/** Form-action wrapper for the dashboard's create form. */
export async function createBoardFromForm(formData: FormData): Promise<void> {
  const title = String(formData.get("title") ?? "");
  await createBoardAction(title);
}

export async function shareBoardAction(
  boardId: string,
  email: string,
  role: Role,
): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Not signed in." };
  if (!rateLimit(`share:${session.user.id}`, 20, 60_000)) {
    return { ok: false, error: "Too many invites — try again in a minute." };
  }
  // Server actions cross the wire — re-validate everything at runtime.
  const cleanEmail = email.trim().toLowerCase().slice(0, 254);
  if (!EMAIL_RE.test(cleanEmail)) {
    return { ok: false, error: "That doesn't look like an email address." };
  }
  if (role !== "editor" && role !== "viewer") {
    return { ok: false, error: "Invalid role." };
  }
  // Only editors may share (viewers have no mutation rights, spec §5).
  const myRole = await getMembership(boardId, session.user.id);
  if (myRole !== "editor") return { ok: false, error: "Only editors can invite." };
  const result = await shareBoard(boardId, cleanEmail, role);
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}
