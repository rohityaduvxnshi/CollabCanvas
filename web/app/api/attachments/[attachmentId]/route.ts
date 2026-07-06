/**
 * GET /api/attachments/:attachmentId (N5) — download a file. Requires a session
 * AND membership in the attachment's database. Always served as a download
 * (Content-Disposition: attachment + nosniff) so an uploaded HTML/SVG can't be
 * rendered inline as stored XSS.
 */

import { NextResponse } from "next/server";
import type { Role } from "@collabcanvas/shared";
import { auth } from "@/lib/auth";
import { getDatabaseMembership } from "@/lib/databases";
import { getMembership } from "@/lib/boards";
import { renameUserFile } from "@/lib/files";
import {
  deleteAttachment,
  getAttachment,
  readAttachmentBytes,
} from "@/lib/attachments";

/** The requester's role on the attachment's container (board OR database), or
 *  null if they aren't a member. Owner is handled separately by the caller. */
async function containerRole(
  row: { databaseId: string | null; boardId: string | null },
  userId: string,
): Promise<Role | null> {
  if (row.databaseId) return getDatabaseMembership(row.databaseId, userId);
  if (row.boardId) return getMembership(row.boardId, userId);
  return null;
}

/** RFC 5987 filename for Content-Disposition (ASCII fallback + UTF-8). */
function contentDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const utf8 = encodeURIComponent(name);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ attachmentId: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { attachmentId } = await params;
  const row = await getAttachment(attachmentId);
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Access: the owner, or any member of the container (board or database) the
  // file was uploaded in.
  const isOwner = row.ownerId === session.user.id;
  if (!isOwner && !(await containerRole(row, session.user.id))) {
    return NextResponse.json({ error: "No access" }, { status: 403 });
  }

  let bytes: Buffer;
  try {
    bytes = await readAttachmentBytes(row.storageKey);
  } catch {
    return NextResponse.json({ error: "File missing" }, { status: 410 });
  }

  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": contentDisposition(row.name),
      "Content-Length": String(row.size),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}

/** Delete an attachment (its uploader, or an editor of the owning database) —
 *  frees the uploader's storage quota. */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ attachmentId: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const { attachmentId } = await params;
  const row = await getAttachment(attachmentId);
  if (!row) return NextResponse.json({ ok: true }); // already gone

  const isOwner = row.ownerId === session.user.id;
  const isEditor = (await containerRole(row, session.user.id)) === "editor";
  if (!isOwner && !isEditor) {
    return NextResponse.json({ error: "No access" }, { status: 403 });
  }
  await deleteAttachment(attachmentId);
  return NextResponse.json({ ok: true });
}

/** Rename a file (its uploader only) — used by the file manager. */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ attachmentId: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const { attachmentId } = await params;
  const body = (await req.json().catch(() => null)) as { name?: string } | null;
  const name = typeof body?.name === "string" ? body.name : "";
  const ok = await renameUserFile(session.user.id, attachmentId, name);
  if (!ok) return NextResponse.json({ error: "Couldn't rename." }, { status: 400 });
  return NextResponse.json({ ok: true });
}
