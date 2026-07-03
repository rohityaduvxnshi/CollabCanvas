/**
 * GET /api/rooms/:boardId/ws-token (spec §5).
 *
 * Requires a valid Auth.js session AND board membership. Returns a short-lived
 * HS256 JWT the WS server verifies: { sub, room, role, name, image?, exp+5m }.
 */

import { NextResponse } from "next/server";
import { SignJWT } from "jose";
import { auth } from "@/lib/auth";
import { getMembership } from "@/lib/boards";
import { rateLimit } from "@/lib/rateLimit";
import type { WsTokenClaims } from "@collabcanvas/shared";

const TOKEN_TTL_SECONDS = 5 * 60;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ boardId: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  // Generous: legit clients refresh at most ~6/min (10s client-side throttle).
  if (!rateLimit(`ws-token:${session.user.id}`, 30, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const { boardId } = await params;
  const role = await getMembership(boardId, session.user.id);
  if (!role) {
    return NextResponse.json({ error: "Not a member of this board" }, { status: 403 });
  }

  const secret = process.env.WS_JWT_SECRET;
  if (!secret) {
    console.error("[ws-token] WS_JWT_SECRET is not set");
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  const claims: Omit<WsTokenClaims, "sub"> = {
    room: boardId,
    role,
    name: session.user.name ?? session.user.email ?? "Someone",
    ...(session.user.image ? { image: session.user.image } : {}),
  };

  const token = await new SignJWT({ ...claims })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(session.user.id)
    .setIssuedAt()
    .setExpirationTime(`${TOKEN_TTL_SECONDS}s`)
    .sign(new TextEncoder().encode(secret));

  return NextResponse.json({ token });
}
