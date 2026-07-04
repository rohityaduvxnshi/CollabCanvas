import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getPageMembership, getPageTitle } from "@/lib/pages";
import { PageRoomProvider } from "@/lib/page/PageRoomProvider";
import { PageScreen } from "@/lib/page/PageScreen";

/**
 * Page route (N2): requires a session AND page membership (the ws-token route
 * double-checks). Mirrors the board page.
 */
export default async function DocPage({
  params,
}: {
  params: Promise<{ pageId: string }>;
}) {
  const { pageId } = await params;

  const session = await auth();
  if (!session?.user?.id) redirect(`/?from=${encodeURIComponent(`/pages/${pageId}`)}`);

  const role = await getPageMembership(pageId, session.user.id);
  if (!role) redirect("/?denied=1");

  const title = await getPageTitle(pageId);
  if (title === null) redirect("/");

  return (
    <PageRoomProvider
      pageId={pageId}
      canEdit={role === "editor"}
      user={{
        id: session.user.id,
        name: session.user.name ?? session.user.email ?? "Someone",
        ...(session.user.image ? { image: session.user.image } : {}),
      }}
    >
      <PageScreen initialTitle={title} />
    </PageRoomProvider>
  );
}
