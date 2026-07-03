/**
 * WS connection auth (spec §5): verify the short-lived HS256 JWT minted by the
 * web app's /api/rooms/:boardId/ws-token route. The token must be valid,
 * unexpired, and issued for exactly the room the socket asked to join.
 *
 * If WS_JWT_SECRET is unset, enforcement is OFF (open dev mode) — logged loudly
 * at startup. Production (Fly) must set it; the web app refuses to mint tokens
 * without it, so a mismatch fails closed on the client side too.
 */

import { jwtVerify } from "jose";
import type { Role, WsTokenClaims } from "@collabcanvas/shared";

const secret = process.env.WS_JWT_SECRET;
export const authEnabled = Boolean(secret);

export interface ConnAuth {
  userId: string;
  role: Role;
  name: string;
}

/** Verify a token for a room. Returns auth info, or null to reject the socket. */
export async function verifyWsToken(
  token: string | null,
  room: string,
): Promise<ConnAuth | null> {
  if (!authEnabled) {
    return { userId: "anonymous", role: "editor", name: "Anonymous" };
  }
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
      algorithms: ["HS256"],
    });
    const claims = payload as unknown as WsTokenClaims;
    // Room names on the wire are `board:<id>`; the token's claim is the bare id.
    const expectedRoom = room.startsWith("board:") ? room.slice("board:".length) : room;
    if (claims.room !== expectedRoom) return null;
    if (claims.role !== "editor" && claims.role !== "viewer") return null;
    if (typeof payload.sub !== "string") return null;
    return { userId: payload.sub, role: claims.role, name: claims.name ?? "Someone" };
  } catch {
    return null; // bad signature, expired, malformed
  }
}
