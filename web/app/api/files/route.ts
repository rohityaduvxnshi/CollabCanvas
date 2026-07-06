/**
 * GET /api/files (N9) — the current user's uploaded files as FileRefs, for the
 * "reuse a file" picker (attach an existing file to another card/column without
 * re-uploading). Only your OWN files; you can always download what you own.
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { listUserFiles } from "@/lib/files";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const files = await listUserFiles(session.user.id);
  return NextResponse.json({
    files: files.map((f) => ({ id: f.id, name: f.name, size: f.size })),
  });
}
