/**
 * N5 file-attachment harness — exercises the REAL web/lib/attachments.ts
 * (no server-only) against the local dev Postgres + a temp storage dir. Focus:
 * the SERVER-ENFORCED caps (10 MB/file, 5 GB/user), disk write/read/delete,
 * and quota accounting. Membership-gated download is the same getDatabaseMembership
 * path proven in phase4/N4; here we test storage + quota.
 *
 * Run:  npx tsx scripts/phase-n5-attachments.ts   (no servers needed)
 */

import { tmpdir } from "node:os";
import { join } from "node:path";
process.loadEnvFile("packages/db/.env");
process.env.FILE_STORAGE_DIR = join(tmpdir(), "cc-n5-test-store");

import { getPrisma } from "../packages/db/src/index";
import { LIMITS } from "@collabcanvas/shared";

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean) {
  console.log(`${ok ? "✅" : "❌"} ${name}`);
  ok ? passed++ : failed++;
}

/**
 * Fill a user's usage to `target` bytes using Int32-safe rows. The per-file
 * `size` column is Int (files are ≤10 MB), but the per-USER cap is 5 GB, so a
 * single synthetic near-cap row would overflow Int32 — spread it across rows.
 */
async function fillUsageTo(
  prisma: ReturnType<typeof getPrisma>,
  ownerId: string,
  databaseId: string,
  target: number,
): Promise<string[]> {
  const CHUNK = 2_000_000_000; // < Int32 max (2,147,483,647)
  const ids: string[] = [];
  let remaining = target;
  let i = 0;
  while (remaining > 0) {
    const size = Math.min(remaining, CHUNK);
    const r = await prisma.attachment.create({
      data: {
        ownerId,
        databaseId,
        name: `filler-${i}`,
        size,
        mimeType: "application/octet-stream",
        storageKey: `filler-no-file-${i}`,
      },
    });
    ids.push(r.id);
    remaining -= size;
    i++;
  }
  return ids;
}

async function main() {
  const att = await import("../web/lib/attachments");
  const prisma = getPrisma();

  const user = await prisma.user.upsert({
    where: { email: "n5@test.local" },
    create: { email: "n5@test.local", name: "N5" },
    update: {},
  });
  // Clean slate.
  await prisma.attachment.deleteMany({ where: { ownerId: user.id } });
  await prisma.database.deleteMany({ where: { ownerId: user.id } });
  const db = await prisma.database.create({
    data: {
      title: "N5 DB",
      ownerId: user.id,
      members: { create: { userId: user.id, role: "editor" } },
    },
  });

  // -- per-file size gate --------------------------------------------------
  check("checkFileSize: normal file ok", att.checkFileSize(1234).ok === true);
  check("checkFileSize: empty rejected", att.checkFileSize(0).ok === false);
  check("checkFileSize: over the per-file cap rejected", att.checkFileSize(LIMITS.fileMaxBytes + 1).ok === false);
  check("checkFileSize: exactly the per-file cap ok", att.checkFileSize(LIMITS.fileMaxBytes).ok === true);

  // -- store + usage -------------------------------------------------------
  const bytes = Buffer.from("hello attachment world");
  const stored = await att.storeAttachment(user.id, { databaseId: db.id }, "note.txt", "text/plain", bytes);
  check("storeAttachment: succeeds", stored.ok === true);
  const attId = stored.ok ? stored.attachment.id : "";
  check("storeAttachment: usage reflects file size", (await att.userUsageBytes(user.id)) === bytes.byteLength);
  const row = await prisma.attachment.findUnique({ where: { id: attId } });
  check("storeAttachment: file exists on disk", !!row && (await att.attachmentFileExists(row.storageKey)));
  const readBack = row ? await att.readAttachmentBytes(row.storageKey) : Buffer.alloc(0);
  check("readAttachmentBytes: round-trips the content", readBack.toString() === "hello attachment world");

  // -- per-file cap enforced by storeAttachment (measures ACTUAL bytes) ----
  const big = Buffer.alloc(LIMITS.fileMaxBytes + 1000, 1);
  const bigStored = await att.storeAttachment(user.id, { databaseId: db.id }, "big.bin", "application/octet-stream", big);
  check("storeAttachment: oversized file rejected", bigStored.ok === false);
  check("storeAttachment: rejected file did NOT add to usage", (await att.userUsageBytes(user.id)) === bytes.byteLength);

  // -- per-user quota (simulate near-cap with Int32-safe filler rows) ------
  const nearCapIds = await fillUsageTo(
    prisma,
    user.id,
    db.id,
    LIMITS.userStorageBytes - bytes.byteLength - 1000, // ~1000 B headroom (note.txt already stored)
  );
  check("canUpload: a small file within the remaining quota is allowed", (await att.canUpload(user.id, 500)).ok === true);
  check("canUpload: a file that would exceed the cap is rejected", (await att.canUpload(user.id, 5000)).ok === false);
  const rowsBefore = await prisma.attachment.count({ where: { ownerId: user.id } });
  const overQuota = await att.storeAttachment(user.id, { databaseId: db.id }, "over.bin", "application/octet-stream", Buffer.alloc(5000, 2));
  check("storeAttachment: over-quota upload rejected", overQuota.ok === false);
  // Ensure no orphan file/row was written for the rejected over-quota upload.
  check(
    "storeAttachment: over-quota upload wrote NO new row",
    (await prisma.attachment.count({ where: { ownerId: user.id } })) === rowsBefore,
  );

  await prisma.attachment.deleteMany({ where: { id: { in: nearCapIds } } });

  // -- delete frees quota --------------------------------------------------
  const before = await att.userUsageBytes(user.id);
  await att.deleteAttachment(attId);
  const after = await att.userUsageBytes(user.id);
  check("deleteAttachment: frees the quota", before - after === bytes.byteLength);
  check("deleteAttachment: removes the on-disk file", row ? !(await att.attachmentFileExists(row.storageKey)) : false);
  check("deleteAttachment: removes the row", (await prisma.attachment.findUnique({ where: { id: attId } })) === null);

  // -- per-user serialization bounds the quota under concurrency -----------
  // Leave room for exactly 2 small files, then fire 6 concurrent uploads: with
  // the read-then-write race UNfixed, all 6 read the same baseline and pass
  // (usage blows past the cap); with per-user serialization, exactly 2 fit.
  await prisma.attachment.deleteMany({ where: { ownerId: user.id } });
  const fileSize = 100_000;
  await fillUsageTo(prisma, user.id, db.id, LIMITS.userStorageBytes - fileSize * 2 - 1); // room for exactly 2
  const cbuf = Buffer.alloc(fileSize, 3);
  const conc = await Promise.all(
    Array.from({ length: 6 }, () =>
      att.storeAttachment(user.id, { databaseId: db.id }, "c.bin", "application/octet-stream", cbuf),
    ),
  );
  check("concurrency: exactly the 2 files that fit succeed", conc.filter((r) => r.ok).length === 2);
  check("concurrency: usage never exceeds the cap", (await att.userUsageBytes(user.id)) <= LIMITS.userStorageBytes);
  await prisma.attachment.deleteMany({ where: { ownerId: user.id } });

  // -- cleanup -------------------------------------------------------------
  await prisma.database.delete({ where: { id: db.id } }).catch(() => {});

  console.log(`\nphase-n5: ${passed}/${passed + failed} checks passed`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
