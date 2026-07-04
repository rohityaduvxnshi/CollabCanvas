/**
 * GET /api/databases/:databaseId/ws-token (N4).
 *
 * Requires a session AND database membership. Returns a short-lived HS256 JWT
 * the WS server verifies for the `db:<id>` room (mirrors the board/page routes;
 * the `room` claim is the bare database id).
 */

import { NextResponse } from "next/server";
import { SignJWT } from "jose";
import { auth } from "@/lib/auth";
import { getDatabaseMembership } from "@/lib/databases";
import { rateLimit } from "@/lib/rateLimit";
import type { WsTokenClaims } from "@collabcanvas/shared";

const TOKEN_TTL_SECONDS = 5 * 60;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ databaseId: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  if (!rateLimit(`ws-token:${session.user.id}`, 30, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const { databaseId } = await params;
  const role = await getDatabaseMembership(databaseId, session.user.id);
  if (!role) {
    return NextResponse.json({ error: "Not a member of this database" }, { status: 403 });
  }

  const secret = process.env.WS_JWT_SECRET;
  if (!secret) {
    console.error("[ws-token] WS_JWT_SECRET is not set");
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  const claims: Omit<WsTokenClaims, "sub"> = {
    room: databaseId,
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
