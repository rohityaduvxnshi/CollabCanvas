/**
 * Per-tab guest identity for presence (Phase 2). Until auth lands in Phase 4,
 * each browser TAB gets a stable random name + color, kept in sessionStorage
 * (per-tab by design — two tabs act as two distinct collaborators, which is
 * exactly what the demo needs). Phase 4 replaces this with the session user.
 */

export interface LocalUser {
  id: string;
  name: string;
  color: string;
  image?: string;
}

const STORAGE_KEY = "collabcanvas.guest";

// Design-system band palette (light-theme values — presence colors are fixed
// per user, so they can't flip with the theme; these pastels read fine on both).
const COLORS = [
  "#c7b8ff", // band-violet
  "#ff9f8a", // band-coral
  "#6fe0d0", // band-teal
  "#ffdf8a", // band-sun
  "#a9d0ff", // band-sky
  "#ffb3c1", // band-pink
  "#8ee6b0", // green
  "#ffcf4d", // sun
];

const ADJECTIVES = ["Brave", "Calm", "Clever", "Eager", "Gentle", "Keen", "Swift", "Witty"];
const ANIMALS = ["Otter", "Falcon", "Panda", "Lynx", "Dolphin", "Badger", "Heron", "Fox"];

const pick = <T,>(arr: readonly T[]): T =>
  arr[Math.floor(Math.random() * arr.length)];

function makeGuest(): LocalUser {
  const name = `${pick(ADJECTIVES)} ${pick(ANIMALS)}`;
  return {
    id: `guest-${Math.random().toString(36).slice(2, 10)}`,
    name,
    color: pick(COLORS),
  };
}

/** Deterministic palette color for a real user id (guests pick randomly). */
export function colorForUserId(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return COLORS[Math.abs(hash) % COLORS.length];
}

/** Get (or create) this tab's guest identity. Client-only. */
export function getLocalUser(): LocalUser {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<LocalUser>;
      if (parsed.id && parsed.name && parsed.color) return parsed as LocalUser;
    }
  } catch {
    // sessionStorage unavailable (private mode edge cases) — fall through.
  }
  const guest = makeGuest();
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(guest));
  } catch {
    // Non-fatal: identity just won't survive a reload.
  }
  return guest;
}
