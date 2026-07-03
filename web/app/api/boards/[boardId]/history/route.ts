/**
 * Board snapshot history (Phase 5).
 *   GET  — list versions (any member).
 *   POST — save a version from the current server snapshot (editors only).
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getMembership, listHistory, saveHistoryVersion } from "@/lib/boards";
import { rateLimit } from "@/lib/rateLimit";
import { LIMITS } from "@collabcanvas/shared";

async function memberRole(boardId: string) {
  const session = await auth();
  if (!session?.user?.id) return { error: 401 as const };
  const role = await getMembership(boardId, session.user.id);
  if (!role) return { error: 403 as const };
  return { role, userId: session.user.id };
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ boardId: string }> },
) {
  const { boardId } = await params;
  const access = await memberRole(boardId);
  if ("error" in access) {
    return NextResponse.json({ error: "Forbidden" }, { status: access.error });
  }
  return NextResponse.json({ versions: await listHistory(boardId) });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ boardId: string }> },
) {
  const { boardId } = await params;
  const access = await memberRole(boardId);
  if ("error" in access) {
    return NextResponse.json({ error: "Forbidden" }, { status: access.error });
  }
  if (access.role !== "editor") {
    return NextResponse.json({ error: "Editors only" }, { status: 403 });
  }
  if (!rateLimit(`history-save:${access.userId}`, 10, 60_000)) {
    return NextResponse.json({ error: "Too many snapshots — slow down" }, { status: 429 });
  }

  let label: string | null = null;
  try {
    const body = (await req.json()) as { label?: unknown };
    if (typeof body.label === "string")
      label = body.label.trim().slice(0, LIMITS.historyLabel) || null;
  } catch {
    // empty body is fine — unlabeled snapshot
  }

  const version = await saveHistoryVersion(boardId, label);
  if (!version) {
    return NextResponse.json(
      { error: "Nothing to snapshot yet — make an edit first." },
      { status: 409 },
    );
  }
  return NextResponse.json({ version });
}
