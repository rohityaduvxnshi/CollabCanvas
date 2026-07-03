/**
 * Structured logging (Phase 6): one JSON line per event — greppable in WinSW's
 * rolled log files and machine-parseable later. ponytail: 20 lines, no logging
 * framework; add one only if we ever need transports/sampling.
 */

type Level = "info" | "warn" | "error";

function line(level: Level, msg: string, fields?: Record<string, unknown>): void {
  const entry = { ts: new Date().toISOString(), level, msg, ...fields };
  const out = JSON.stringify(entry);
  if (level === "error") console.error(out);
  else if (level === "warn") console.warn(out);
  else console.log(out);
}

export const log = {
  info: (msg: string, fields?: Record<string, unknown>) => line("info", msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => line("warn", msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => line("error", msg, fields),
};
