/**
 * Loads .env BEFORE any other module reads process.env. ES module imports are
 * hoisted and execute depth-first, so this must be index.ts's FIRST import —
 * a loadEnvFile() call in index.ts's body would run after persistence.ts has
 * already read DATABASE_URL at module init.
 */
import process from "node:process";

try {
  process.loadEnvFile();
} catch {
  // No .env file — rely on real environment variables.
}
