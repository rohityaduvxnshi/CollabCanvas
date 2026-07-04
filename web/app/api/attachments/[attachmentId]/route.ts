/**
 * GET /api/attachments/:attachmentId (N5) — download a file. Requires a session
 * AND membership in the attachment's database. Always served as a download
 * (Content-Disposition: attachment + nosniff) so an uploaded HTML/SVG can't be
 * rendered inline as stored XSS.
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDatabaseMembership } from "@/lib/databases";
import {
  deleteAttachment,
  getAttachment,
  readAttachmentBytes,
} from "@/lib/attachments";

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

  // Access is gated by membership in the OWNING database (not the uploader).
  const role = await getDatabaseMembership(row.databaseId, session.user.id);
  if (!role) return NextResponse.json({ error: "No access" }, { status: 403 });

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
  const isEditor = (await getDatabaseMembership(row.databaseId, session.user.id)) === "editor";
  if (!isOwner && !isEditor) {
    return NextResponse.json({ error: "No access" }, { status: 403 });
  }
  await deleteAttachment(attachmentId);
  return NextResponse.json({ ok: true });
}
