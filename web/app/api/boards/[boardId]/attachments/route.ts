/**
 * POST /api/boards/:boardId/attachments (N9) — multipart file upload attached
 * to a board's cards/columns (editors only). Same server-enforced caps as the
 * database route (10 MB/file, 5 GB/user, measured on ACTUAL bytes); returns the
 * FileRef the client stores in the card/column's `files` list. Download +
 * delete flow through the shared /api/attachments/:id route (access gated by
 * board membership via the attachment's boardId).
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getMembership } from "@/lib/boards";
import { rateLimit } from "@/lib/rateLimit";
import { storeAttachment } from "@/lib/attachments";
import { LIMITS } from "@collabcanvas/shared";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ boardId: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  if (!rateLimit(`upload:${session.user.id}`, 60, 60_000)) {
    return NextResponse.json({ error: "Too many uploads — slow down." }, { status: 429 });
  }

  const { boardId } = await params;
  const role = await getMembership(boardId, session.user.id);
  if (role !== "editor") {
    return NextResponse.json({ error: "Only editors can upload files." }, { status: 403 });
  }

  // Require a Content-Length and reject oversized bodies BEFORE buffering — a
  // chunked upload with no length could otherwise buffer unboundedly via
  // formData() and OOM the process (same guard as the database route).
  const declared = Number(req.headers.get("content-length"));
  if (!Number.isFinite(declared) || declared <= 0 || declared > LIMITS.fileMaxBytes + 64 * 1024) {
    return NextResponse.json({ error: "Missing or oversized upload." }, { status: 413 });
  }

  let file: File | null = null;
  try {
    const form = await req.formData();
    const f = form.get("file");
    if (f instanceof File) file = f;
  } catch {
    return NextResponse.json({ error: "Invalid upload." }, { status: 400 });
  }
  if (!file) return NextResponse.json({ error: "No file provided." }, { status: 400 });

  const bytes = new Uint8Array(await file.arrayBuffer());
  const result = await storeAttachment(
    session.user.id,
    { boardId },
    file.name,
    file.type,
    bytes,
  );
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ attachment: result.attachment });
}
