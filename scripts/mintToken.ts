/** Test helper: mint a ws-token the way the web app's routes do. */

import process from "node:process";
import { SignJWT } from "jose";

process.loadEnvFile("ws-server/.env");

const SECRET = process.env.WS_JWT_SECRET;

/** Sign an editor token for a room (`board:x`, `page:x`, or a bare id). The
 *  `room` claim is the bare id — the server strips either prefix. */
export async function mintEditorToken(
  room: string,
  ttl: string = "10m",
): Promise<string | null> {
  if (!SECRET) return null; // auth disabled on the server → no token needed
  const colon = room.indexOf(":");
  const bare = colon === -1 ? room : room.slice(colon + 1);
  return new SignJWT({ room: bare, role: "editor", name: "Harness" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("test-harness")
    .setIssuedAt()
    .setExpirationTime(ttl)
    .sign(new TextEncoder().encode(SECRET));
}
