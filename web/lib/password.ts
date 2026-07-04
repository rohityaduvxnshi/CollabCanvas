/**
 * Password hashing (Phase 7) — Node stdlib scrypt, no bcrypt dependency.
 * Stored format: "<salt hex>:<hash hex>".
 */

import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, 64);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(":");
  // Reject malformed hashes BEFORE paying for the KDF (Ph7 review).
  if (!saltHex || !hashHex || hashHex.length !== 128) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = await scryptAsync(password, Buffer.from(saltHex, "hex"), 64);
  return timingSafeEqual(actual, expected);
}
