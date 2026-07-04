import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getDatabaseMembership, getDatabaseTitle } from "@/lib/databases";
import { DbRoomProvider } from "@/lib/db/DbRoomProvider";
import { DbScreen } from "@/lib/db/DbScreen";

/**
 * Database route (N4): requires a session AND database membership (the ws-token
 * route double-checks). Mirrors the page route.
 */
export default async function DatabasePage({
  params,
}: {
  params: Promise<{ databaseId: string }>;
}) {
  const { databaseId } = await params;

  const session = await auth();
  if (!session?.user?.id) redirect(`/?from=${encodeURIComponent(`/databases/${databaseId}`)}`);

  const role = await getDatabaseMembership(databaseId, session.user.id);
  if (!role) redirect("/?denied=1");

  const title = await getDatabaseTitle(databaseId);
  if (title === null) redirect("/");

  return (
    <DbRoomProvider
      databaseId={databaseId}
      databaseTitle={title}
      canEdit={role === "editor"}
    >
      <DbScreen initialTitle={title} />
    </DbRoomProvider>
  );
}
