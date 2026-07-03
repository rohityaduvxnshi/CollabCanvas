/**
 * GET a single history version's snapshot bytes (base64) — editors only, used
 * by the client-side restore transplant (see web/lib/yjs/restore.ts).
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getHistoryState, getMembership } from "@/lib/boards";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ boardId: string; versionId: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const { boardId, versionId } = await params;
  const role = await getMembership(boardId, session.user.id);
  if (role !== "editor") {
    return NextResponse.json({ error: "Editors only" }, { status: 403 });
  }

  const state = await getHistoryState(boardId, versionId);
  if (!state) {
    return NextResponse.json({ error: "Version not found" }, { status: 404 });
  }
  return NextResponse.json({ state: Buffer.from(state).toString("base64") });
}
