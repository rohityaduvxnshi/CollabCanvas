// Prisma 7 CLI config: the datasource URL lives here (not in schema.prisma).
// Loads DATABASE_URL from this package's .env for local dev; deploys read the
// real env var (Neon) instead.
import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env["DATABASE_URL"],
  },
});
