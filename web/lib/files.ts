/**
 * File manager data (N9). Lists a user's uploaded files across every container
 * (board cards/columns + database cells) with where each one lives, so the
 * /files page can show, reuse, rename, and remove them. No "server-only" (like
 * attachments.ts) so it stays harness-testable.
 */

import { getPrisma } from "@collabcanvas/db";

export interface UserFile {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  createdAt: Date;
  /** Where the file was uploaded — also what gates who else can download it. */
  container:
    | { kind: "board"; id: string; title: string }
    | { kind: "database"; id: string; title: string }
    | { kind: "none" };
}

/** Every file this user owns, newest first, with its container. */
export async function listUserFiles(ownerId: string): Promise<UserFile[]> {
  const rows = await getPrisma().attachment.findMany({
    where: { ownerId },
    orderBy: { createdAt: "desc" },
    include: {
      board: { select: { id: true, title: true } },
      database: { select: { id: true, title: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    size: r.size,
    mimeType: r.mimeType,
    createdAt: r.createdAt,
    container: r.board
      ? { kind: "board" as const, id: r.board.id, title: r.board.title }
      : r.database
        ? { kind: "database" as const, id: r.database.id, title: r.database.title }
        : { kind: "none" as const },
  }));
}

/** Rename a file (canonical Attachment.name). Only the uploader may rename.
 *  ponytail: card/db-cell chips keep their denormalized name until re-derived
 *  from a fresh upload — the download name (Content-Disposition) updates now;
 *  syncing every reference is a follow-up (there's no reverse index today). */
export async function renameUserFile(
  ownerId: string,
  id: string,
  name: string,
): Promise<boolean> {
  const clean = name.trim().slice(0, 255);
  if (!clean) return false;
  const { count } = await getPrisma().attachment.updateMany({
    where: { id, ownerId },
    data: { name: clean },
  });
  return count > 0;
}
