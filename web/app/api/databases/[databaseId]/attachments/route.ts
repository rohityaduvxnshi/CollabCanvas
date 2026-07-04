/**
 * POST /api/databases/:databaseId/attachments (N5) — multipart file upload to
 * a database (editors only). Server enforces the 5 MB/file and 500 MB/user
 * caps on the ACTUAL bytes; returns the attachment metadata the client stores
 * in the row's attachment cell.
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDatabaseMembership } from "@/lib/databases";
import { rateLimit } from "@/lib/rateLimit";
import { storeAttachment } from "@/lib/attachments";
import { LIMITS } from "@collabcanvas/shared";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ databaseId: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  if (!rateLimit(`upload:${session.user.id}`, 60, 60_000)) {
    return NextResponse.json({ error: "Too many uploads — slow down." }, { status: 429 });
  }

  const { databaseId } = await params;
  const role = await getDatabaseMembership(databaseId, session.user.id);
  if (role !== "editor") {
    return NextResponse.json({ error: "Only editors can upload files." }, { status: 403 });
  }

  // Require a Content-Length and reject oversized bodies BEFORE buffering.
  // Route handlers have no default body-size limit, so a chunked upload with no
  // length could otherwise buffer unboundedly via formData() and OOM the
  // process. (Belt-and-suspenders: prod should also set a Caddy
  // `request_body max_size` at the edge — see deploy/README.md.)
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
    databaseId,
    file.name,
    file.type,
    bytes,
  );
  if (!result.ok) {
    // Size/quota failures are 413/507; keep it simple with 400 + message.
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ attachment: result.attachment });
}
