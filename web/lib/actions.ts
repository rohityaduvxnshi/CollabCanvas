"use server";

/** Server actions: the mutation seam between client components and lib/boards. */

import { redirect } from "next/navigation";
import { AuthError, CredentialsSignin } from "next-auth";
import { auth, signIn, signOut, unstable_update } from "./auth";
import { createBoard, getMembership, shareBoard } from "./boards";
import { createPage, getPageMembership } from "./pages";
import { createDatabase, getDatabaseMembership } from "./databases";
import {
  addWorkspaceMembersToBoard,
  addWorkspaceMembersToDatabase,
  addWorkspaceMembersToPage,
  createTeamWorkspace,
  ensurePrivateWorkspace,
  getWorkspaceMembership,
  shareWorkspace,
} from "./workspaces";
import { rateLimit } from "./rateLimit";
import { getPrisma } from "@collabcanvas/db";
import {
  EMAIL_RE,
  PASSWORD_MIN,
  checkEmail,
  startEmailVerification,
} from "./emailAuth";
import { LIMITS, type Role } from "@collabcanvas/shared";

/** Arg-less wrappers so client `<form action={…}>` can trigger OAuth directly. */
export async function signInGitHubAction() {
  await signIn("github", { redirectTo: "/" });
}
export async function signInGoogleAction() {
  await signIn("google", { redirectTo: "/" });
}

export async function signOutAction() {
  await signOut({ redirectTo: "/" });
}

// ---------------------------------------------------------------------------
// Phase 7: email+password auth (useActionState-shaped: (prev, formData) => state)
// ---------------------------------------------------------------------------

export type AuthStep = "email" | "password" | "setup" | "oauth";
export type AuthFormState = {
  step?: AuthStep;
  error?: string;
  ok?: boolean;
  email?: string;
};

function cleanEmail(formData: FormData): string {
  return String(formData.get("email") ?? "")
    .trim()
    .toLowerCase()
    .slice(0, 254);
}

const RATE_MSG = "Too many attempts — try again in a few minutes.";

/**
 * The whole email-first auth flow in one action (2026-07-05). A hidden `step`
 * field says what the user is submitting; the returned `step` says what to show
 * next. New users never see a password field before we've confirmed the account
 * doesn't exist and mailed them a code (checkEmail → startEmailVerification).
 */
export async function emailFirstAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const email = cleanEmail(formData);
  const step = String(formData.get("step") ?? "email");
  const intent = String(formData.get("intent") ?? "");

  // "← use a different email" resets to the email box.
  if (intent === "change") return { step: "email", email: "" };

  // Resend a setup code — rate-limited, keeps the user on the setup step.
  if (intent === "resend") {
    if (!EMAIL_RE.test(email)) {
      return { step: "setup", email, error: "That doesn't look like an email address." };
    }
    if (!rateLimit(`resend:${email}`, 3, 10 * 60_000)) {
      return { step: "setup", email, error: "Too many codes — wait a few minutes." };
    }
    const r = await startEmailVerification(email).catch(() => ({
      ok: false as const,
      error: "Couldn't send the email — try again shortly.",
    }));
    return r.ok
      ? { step: "setup", email, ok: true }
      : { step: "setup", email, error: r.error };
  }

  // Step ①: an email decides the next step.
  if (step === "email") {
    if (!EMAIL_RE.test(email)) {
      return { step: "email", email, error: "That doesn't look like an email address." };
    }
    if (!rateLimit(`email-continue:${email}`, 10, 60_000)) {
      return { step: "email", email, error: RATE_MSG };
    }
    const status = await checkEmail(email);
    if (status === "known") return { step: "password", email };
    if (status === "oauth") return { step: "oauth", email };
    // new or unverified → mail a code, go set the password.
    const r = await startEmailVerification(email).catch(() => ({
      ok: false as const,
      error: "Couldn't send the verification email — try again shortly.",
    }));
    if (!r.ok) return { step: "email", email, error: r.error };
    return { step: "setup", email };
  }

  // Step ②A: returning user — password sign-in.
  if (step === "password") {
    const password = String(formData.get("password") ?? "");
    if (!password) return { step: "password", email, error: "Enter your password." };
    try {
      await signIn("credentials", { email, password, redirectTo: "/" });
      return { step: "password", email };
    } catch (err) {
      if (!(err instanceof AuthError)) throw err; // NEXT_REDIRECT on success
      const code = err instanceof CredentialsSignin ? err.code : "";
      if (code === "unverified") {
        // Rare (checkEmail sends verified users here) — mail a code, set password.
        await startEmailVerification(email).catch(() => {});
        return { step: "setup", email, error: "Verify your email to finish signing in." };
      }
      if (code === "rate") return { step: "password", email, error: RATE_MSG };
      return { step: "password", email, error: "Wrong password. Try again." };
    }
  }

  // Step ②B: new user — enter the code AND set a password.
  if (step === "setup") {
    const password = String(formData.get("password") ?? "");
    const code = String(formData.get("code") ?? "").trim();
    if (password.length < PASSWORD_MIN) {
      return {
        step: "setup",
        email,
        error: `Password must be at least ${PASSWORD_MIN} characters.`,
      };
    }
    if (!/^\d{6}$/.test(code)) {
      return { step: "setup", email, error: "Enter the 6-digit code from your email." };
    }
    try {
      await signIn("credentials", { email, password, code, mode: "setup", redirectTo: "/" });
      return { step: "setup", email };
    } catch (err) {
      if (!(err instanceof AuthError)) throw err;
      if (err instanceof CredentialsSignin && err.code === "rate") {
        return { step: "setup", email, error: RATE_MSG };
      }
      return { step: "setup", email, error: "Wrong or expired code — check it, or resend." };
    }
  }

  return { step: "email", email }; // oauth step has no submit
}

export async function completeProfileAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  const name = String(formData.get("name") ?? "")
    .trim()
    .slice(0, LIMITS.userName);
  const bio = String(formData.get("bio") ?? "")
    .trim()
    .slice(0, LIMITS.userBio);
  if (!name) return { error: "Tell us your name." };
  try {
    await getPrisma().user.update({
      where: { id: session.user.id },
      data: { name, bio: bio || null },
    });
  } catch {
    redirect("/"); // user row gone (stale JWT) — nothing to save
  }
  // Push the name into the JWT — without this, presence and the dashboard
  // keep showing the raw email for the token's lifetime (Ph7 review).
  await unstable_update({ user: { name } });
  redirect("/");
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

/** Resolve the target workspace from a form field: the given workspace if the
 *  user is an editor there, else the user's Private workspace (safe default). */
async function resolveWorkspaceId(userId: string, raw: unknown): Promise<string> {
  const wsId = typeof raw === "string" ? raw : "";
  if (wsId && (await getWorkspaceMembership(wsId, userId)) === "editor") return wsId;
  return ensurePrivateWorkspace(userId);
}

/** Form-action wrapper for the dashboard's create form (N3: files under the
 *  selected workspace + inherits its members). */
export async function createBoardFromForm(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  if (!rateLimit(`create-board:${session.user.id}`, 20, 60_000)) redirect("/");
  const title = String(formData.get("title") ?? "").trim().slice(0, LIMITS.boardTitle);
  const wsId = await resolveWorkspaceId(session.user.id, formData.get("workspaceId"));
  const boardId = await createBoard(session.user.id, title, wsId);
  await addWorkspaceMembersToBoard(wsId, boardId);
  redirect(`/boards/${boardId}`);
}

// ---------------------------------------------------------------------------
// N2: doc pages
// ---------------------------------------------------------------------------

export async function createPageFromForm(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  if (!rateLimit(`create-page:${session.user.id}`, 20, 60_000)) redirect("/");
  const title = String(formData.get("title") ?? "").trim().slice(0, LIMITS.boardTitle);
  const wsId = await resolveWorkspaceId(session.user.id, formData.get("workspaceId"));
  const pageId = await createPage(session.user.id, title, wsId);
  await addWorkspaceMembersToPage(wsId, pageId);
  redirect(`/pages/${pageId}`);
}

// ---------------------------------------------------------------------------
// N4: databases
// ---------------------------------------------------------------------------

export async function createDatabaseFromForm(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  if (!rateLimit(`create-db:${session.user.id}`, 20, 60_000)) redirect("/");
  const title = String(formData.get("title") ?? "").trim().slice(0, LIMITS.boardTitle);
  const wsId = await resolveWorkspaceId(session.user.id, formData.get("workspaceId"));
  const databaseId = await createDatabase(session.user.id, title, wsId);
  await addWorkspaceMembersToDatabase(wsId, databaseId);
  redirect(`/databases/${databaseId}`);
}

/** Rename a database (editors only). Called on blur/enter from the header. */
export async function renameDatabaseAction(
  databaseId: string,
  title: string,
): Promise<{ ok: boolean }> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false };
  const role = await getDatabaseMembership(databaseId, session.user.id);
  if (role !== "editor") return { ok: false };
  const clean = title.trim().slice(0, LIMITS.boardTitle) || "Untitled database";
  await getPrisma().database.update({ where: { id: databaseId }, data: { title: clean } });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// N3: workspaces
// ---------------------------------------------------------------------------

export async function createWorkspaceFromForm(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  if (!rateLimit(`create-workspace:${session.user.id}`, 10, 60_000)) redirect("/");
  const name = String(formData.get("name") ?? "").trim().slice(0, LIMITS.boardTitle);
  const wsId = await createTeamWorkspace(session.user.id, name);
  redirect(`/?ws=${wsId}`);
}

export async function shareWorkspaceAction(
  workspaceId: string,
  email: string,
  role: Role,
): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Not signed in." };
  if (!rateLimit(`share:${session.user.id}`, 20, 60_000)) {
    return { ok: false, error: "Too many invites — try again in a minute." };
  }
  const cleanEmail = email.trim().toLowerCase().slice(0, 254);
  if (!EMAIL_RE.test(cleanEmail)) {
    return { ok: false, error: "That doesn't look like an email address." };
  }
  if (role !== "editor" && role !== "viewer") {
    return { ok: false, error: "Invalid role." };
  }
  if ((await getWorkspaceMembership(workspaceId, session.user.id)) !== "editor") {
    return { ok: false, error: "Only workspace editors can invite." };
  }
  const result = await shareWorkspace(workspaceId, cleanEmail, role);
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}

/** Form wrapper: share a workspace, then redirect back to it with a status. */
export async function shareWorkspaceFromForm(formData: FormData): Promise<void> {
  const workspaceId = String(formData.get("workspaceId") ?? "");
  const email = String(formData.get("email") ?? "");
  const role: Role = String(formData.get("role") ?? "editor") === "viewer" ? "viewer" : "editor";
  const res = await shareWorkspaceAction(workspaceId, email, role);
  const q = res.ok
    ? `invited=${encodeURIComponent(email)}`
    : `shareError=${encodeURIComponent(res.error ?? "Failed")}`;
  redirect(`/?ws=${encodeURIComponent(workspaceId)}&${q}`);
}

/** Rename a page (editors only). Called on blur/enter from the page header. */
export async function renamePageAction(
  pageId: string,
  title: string,
): Promise<{ ok: boolean }> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false };
  const role = await getPageMembership(pageId, session.user.id);
  if (role !== "editor") return { ok: false };
  const clean = title.trim().slice(0, LIMITS.boardTitle) || "Untitled page";
  await getPrisma().page.update({ where: { id: pageId }, data: { title: clean } });
  return { ok: true };
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
