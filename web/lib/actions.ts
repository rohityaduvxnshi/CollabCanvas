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
  issueVerificationCode,
  signUpEmail,
} from "./emailAuth";
import { LIMITS, type Role } from "@collabcanvas/shared";

export async function signInAction(provider: "github" | "google") {
  await signIn(provider, { redirectTo: "/" });
}

export async function signOutAction() {
  await signOut({ redirectTo: "/" });
}

// ---------------------------------------------------------------------------
// Phase 7: email+password auth (useActionState-shaped: (prev, formData) => state)
// ---------------------------------------------------------------------------

export type AuthFormState = { error?: string; ok?: boolean; email?: string };

function cleanEmail(formData: FormData): string {
  return String(formData.get("email") ?? "")
    .trim()
    .toLowerCase()
    .slice(0, 254);
}

const RATE_MSG = "Too many attempts — try again in a few minutes.";

/** One action for the /signin form; the submit button sets intent. */
export async function emailAuthAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const email = cleanEmail(formData);
  const password = String(formData.get("password") ?? "");
  const intent = formData.get("intent") === "signup" ? "signup" : "signin";
  if (!EMAIL_RE.test(email)) {
    return { error: "That doesn't look like an email address.", email };
  }
  if (password.length < PASSWORD_MIN) {
    return {
      error: `Password must be at least ${PASSWORD_MIN} characters.`,
      email,
    };
  }

  if (intent === "signup") {
    if (!rateLimit(`signup:${email}`, 3, 10 * 60_000)) {
      return { error: RATE_MSG, email };
    }
    let result;
    try {
      result = await signUpEmail(email, password);
    } catch {
      // Mail provider down — the account may exist now, but say so honestly
      // instead of surfacing Next's opaque digest page (Ph7 review).
      return {
        error: "Couldn't send the verification email — try again shortly.",
        email,
      };
    }
    if (!result.ok) return { error: result.error, email };
    redirect(`/verify?email=${encodeURIComponent(email)}`);
  }

  try {
    await signIn("credentials", { email, password, redirectTo: "/" });
    return {};
  } catch (err) {
    if (!(err instanceof AuthError)) throw err; // NEXT_REDIRECT on success
    const code = err instanceof CredentialsSignin ? err.code : "";
    // Right password, unconfirmed email → the verify page (its Resend button
    // is the single, rate-limited way to get a fresh code).
    if (code === "unverified") redirect(`/verify?email=${encodeURIComponent(email)}`);
    if (code === "rate") return { error: RATE_MSG, email };
    return { error: "Invalid email or password.", email };
  }
}

export async function verifyCodeAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const email = cleanEmail(formData);
  const password = String(formData.get("password") ?? "");
  const code = String(formData.get("code") ?? "").trim();
  if (!EMAIL_RE.test(email) || !/^\d{6}$/.test(code) || !password) {
    return { error: "Enter your password and the 6-digit code from your email." };
  }
  // Brute-force guard lives in authorize (cred-code bucket) — it also covers
  // direct POSTs to the credentials callback.
  try {
    await signIn("credentials", { email, password, code, redirectTo: "/welcome" });
    return {};
  } catch (err) {
    if (!(err instanceof AuthError)) throw err;
    if (err instanceof CredentialsSignin && err.code === "rate") {
      return { error: RATE_MSG };
    }
    return { error: "Wrong code or password — check both, or resend the code." };
  }
}

export async function resendCodeAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const email = cleanEmail(formData);
  if (!EMAIL_RE.test(email)) {
    return { error: "That doesn't look like an email address." };
  }
  if (!rateLimit(`resend:${email}`, 3, 10 * 60_000)) {
    return { error: "Too many codes requested — try again in a few minutes." };
  }
  try {
    await issueVerificationCode(email); // silently no-ops for unknown emails
  } catch {
    return { error: "Couldn't send the email — try again shortly." };
  }
  return { ok: true };
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
