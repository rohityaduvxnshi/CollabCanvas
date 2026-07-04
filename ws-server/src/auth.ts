/**
 * WS connection auth (spec §5): verify the short-lived HS256 JWT minted by the
 * web app's ws-token routes. The token must be valid, unexpired, and issued for
 * exactly the room the socket asked to join.
 *
 * Rooms are `board:<id>` or `page:<id>` (N2); the token's `room` claim is the
 * bare id. ponytail: bare-id compare (strip either prefix) relies on board and
 * page ids never colliding — they're independent cuids, collision is
 * astronomically unlikely; bind the room type into the claim only if that ever
 * changes.
 *
 * If WS_JWT_SECRET is unset, enforcement is OFF (open dev mode) — logged loudly
 * at startup. Production must set it; the web app refuses to mint tokens
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

/** The bare id for a room, stripping the `board:`/`page:` prefix. */
const bareRoomId = (room: string): string => {
  const colon = room.indexOf(":");
  return colon === -1 ? room : room.slice(colon + 1);
};

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
    if (claims.room !== bareRoomId(room)) return null;
    if (claims.role !== "editor" && claims.role !== "viewer") return null;
    if (typeof payload.sub !== "string") return null;
    return { userId: payload.sub, role: claims.role, name: claims.name ?? "Someone" };
  } catch {
    return null; // bad signature, expired, malformed
  }
}
