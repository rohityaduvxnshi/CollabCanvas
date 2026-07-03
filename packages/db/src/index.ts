/**
 * Shared Prisma client for CollabCanvas (imported by ws-server now, web in
 * Phase 4). Prisma 7 `prisma-client` generator emits TS into ./generated/prisma;
 * consumers only ever import from this file.
 */

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";

export type { BoardSnapshot } from "./generated/prisma/client";

let client: PrismaClient | null = null;

/** Lazy singleton — callers that never touch the DB never open a connection.
 *  Prisma 7 requires a driver adapter; DATABASE_URL is read at first use. */
export function getPrisma(): PrismaClient {
  client ??= new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  return client;
}
