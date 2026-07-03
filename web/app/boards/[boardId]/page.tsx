import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getMembership, listMembers } from "@/lib/boards";
import { getPrisma } from "@collabcanvas/db";
import { BoardRoomProvider } from "@/lib/board/BoardRoomProvider";
import { BoardScreen } from "@/components/board/BoardScreen";

/**
 * Board page: requires a session AND board membership (spec Phase 4) —
 * non-members never reach the socket (and the ws-token route double-checks).
 */
export default async function BoardPage({
  params,
}: {
  params: Promise<{ boardId: string }>;
}) {
  const { boardId } = await params;

  const session = await auth();
  if (!session?.user?.id) redirect(`/?from=${encodeURIComponent(`/boards/${boardId}`)}`);

  const role = await getMembership(boardId, session.user.id);
  if (!role) redirect("/?denied=1");

  const [board, members] = await Promise.all([
    getPrisma().board.findUnique({ where: { id: boardId } }),
    listMembers(boardId, session.user.id),
  ]);
  if (!board) redirect("/");

  return (
    <BoardRoomProvider
      boardId={boardId}
      boardTitle={board.title}
      canEdit={role === "editor"}
      user={{
        id: session.user.id,
        name: session.user.name ?? session.user.email ?? "Someone",
        ...(session.user.image ? { image: session.user.image } : {}),
      }}
    >
      <BoardScreen boardId={boardId} members={members} />
    </BoardRoomProvider>
  );
}
