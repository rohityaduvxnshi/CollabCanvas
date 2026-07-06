/**
 * File attachments + storage (N5). Bytes live on disk under FILE_STORAGE_DIR
 * (default <cwd>/.filestore); metadata + ownership + the owning databaseId live
 * in the Attachment table. Caps are enforced SERVER-SIDE here at upload:
 * 5 MB/file and 500 MB/user (LIMITS.fileMaxBytes / userStorageBytes), measured
 * on the actual received bytes — never trusting a client-declared size.
 *
 * No "server-only" (like emailAuth.ts / workspaces.ts) so the phase-n5 harness
 * can exercise the real quota + storage functions.
 *
 * ponytail: the quota check is read-then-write, so two concurrent uploads can
 * race past 500 MB by up to one file (5 MB). Acceptable for a single-node v1;
 * a per-user advisory lock or a usage counter row would tighten it.
 */

import { mkdir, writeFile, unlink, stat } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { getPrisma } from "@collabcanvas/db";
import { LIMITS } from "@collabcanvas/shared";

const STORAGE_DIR = process.env.FILE_STORAGE_DIR ?? join(process.cwd(), ".filestore");

export type UploadGate = { ok: true } | { ok: false; error: string };

const mb = (n: number) => Math.round(n / (1024 * 1024));

/** Total bytes a user is currently storing. */
export async function userUsageBytes(userId: string): Promise<number> {
  const agg = await getPrisma().attachment.aggregate({
    where: { ownerId: userId },
    _sum: { size: true },
  });
  return agg._sum.size ?? 0;
}

/** Per-file size check (authoritative size = actual bytes). */
export function checkFileSize(size: number): UploadGate {
  if (!Number.isFinite(size) || size <= 0) return { ok: false, error: "Empty file." };
  if (size > LIMITS.fileMaxBytes) {
    return { ok: false, error: `File exceeds the ${mb(LIMITS.fileMaxBytes)} MB per-file limit.` };
  }
  return { ok: true };
}

/** Combined gate: per-file + per-user quota. */
export async function canUpload(userId: string, size: number): Promise<UploadGate> {
  const sz = checkFileSize(size);
  if (!sz.ok) return sz;
  const used = await userUsageBytes(userId);
  if (used + size > LIMITS.userStorageBytes) {
    return {
      ok: false,
      error: `Storage full — you're using ${mb(used)} MB of ${mb(LIMITS.userStorageBytes)} MB.`,
    };
  }
  return { ok: true };
}

export interface AttachmentMeta {
  id: string;
  name: string;
  size: number;
  mimeType: string;
}

/** The container a file is uploaded in — a database (N5) or a board (N9).
 *  Exactly one; it also gates download access (owner OR a member of it). */
export type AttachmentContainer = { databaseId: string } | { boardId: string };

/**
 * Serialize per-user uploads so the read-then-write quota check is ATOMIC on
 * this (single) node — without it, N concurrent uploads all read the same
 * near-empty baseline and every one passes canUpload, blowing past the 500 MB
 * cap by up to (rate-limit × file-size). Running them one-at-a-time per user
 * closes that race. (A multi-node deploy would need a shared lock; the target
 * is a single-node VPS.)
 */
const uploadChains = new Map<string, Promise<unknown>>();
function serialByUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const prev = uploadChains.get(userId) ?? Promise.resolve();
  const next = prev.then(fn, fn); // run after prev regardless of its outcome
  uploadChains.set(userId, next.catch(() => {}));
  return next;
}

/**
 * Validate against the quota (using the ACTUAL byte length), write to disk, and
 * record the Attachment row. Returns metadata or an error message. Per-user
 * uploads are serialized so the quota check can't be raced.
 */
export async function storeAttachment(
  ownerId: string,
  container: AttachmentContainer,
  name: string,
  mimeType: string,
  bytes: Uint8Array,
): Promise<{ ok: true; attachment: AttachmentMeta } | { ok: false; error: string }> {
  return serialByUser(ownerId, async () => {
    const size = bytes.byteLength;
    const gate = await canUpload(ownerId, size);
    if (!gate.ok) return { ok: false as const, error: gate.error };

    const storageKey = randomBytes(16).toString("hex"); // server-generated → no path traversal
    await mkdir(STORAGE_DIR, { recursive: true });
    await writeFile(join(STORAGE_DIR, storageKey), bytes);

    const row = await getPrisma().attachment.create({
      data: {
        ownerId,
        databaseId: "databaseId" in container ? container.databaseId : null,
        boardId: "boardId" in container ? container.boardId : null,
        name: (name || "file").slice(0, 255),
        size,
        mimeType: (mimeType || "application/octet-stream").slice(0, 150),
        storageKey,
      },
    });
    return {
      ok: true as const,
      attachment: { id: row.id, name: row.name, size: row.size, mimeType: row.mimeType },
    };
  });
}

export async function getAttachment(id: string) {
  return getPrisma().attachment.findUnique({ where: { id } });
}

/** Metadata for a set of attachment ids (for rendering the cell chips). */
export async function listAttachmentsMeta(ids: string[]): Promise<AttachmentMeta[]> {
  if (ids.length === 0) return [];
  const rows = await getPrisma().attachment.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, size: true, mimeType: true },
  });
  return rows;
}

/** Absolute path to a stored file (storageKey is server-generated hex). */
export function attachmentDiskPath(storageKey: string): string {
  return join(STORAGE_DIR, storageKey);
}

/** Read a stored file's bytes (for the download route). */
export async function readAttachmentBytes(storageKey: string): Promise<Buffer> {
  const { readFile } = await import("node:fs/promises");
  return readFile(join(STORAGE_DIR, storageKey));
}

/** Delete the on-disk bytes + row (best-effort; missing file is not an error). */
export async function deleteAttachment(id: string): Promise<void> {
  const row = await getAttachment(id);
  if (!row) return;
  await unlink(join(STORAGE_DIR, row.storageKey)).catch(() => {});
  await getPrisma().attachment.delete({ where: { id } }).catch(() => {});
}

/** For tests: does a stored file exist on disk? */
export async function attachmentFileExists(storageKey: string): Promise<boolean> {
  try {
    await stat(join(STORAGE_DIR, storageKey));
    return true;
  } catch {
    return false;
  }
}
