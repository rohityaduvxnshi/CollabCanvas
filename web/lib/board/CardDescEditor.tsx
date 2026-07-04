"use client";

/**
 * CardDescEditor (N1) — collaborative rich-text editor for a card's
 * description. Lives in lib/board (the Yjs seam, like BoardRoomProvider);
 * presentational components render it as an opaque child.
 *
 * Binding: TipTap Collaboration (y-sync) on the card's `desc` Y.XmlFragment —
 * edits are LIVE and collaborative (no save button; the card's Save only
 * commits the title). CollaborationCaret shares text cursors through the
 * room's existing awareness.
 *
 * No toolbar (deliberate): StarterKit input rules cover the roadmap scope —
 * **bold**, *italic*, `- `/`1. ` lists, `# ` headings, `> ` quotes — plus the
 * standard Cmd/Ctrl-B/I shortcuts. Undo is Yjs-aware (undoRedo disabled in
 * favor of the Collaboration undo manager).
 */

import { useState } from "react";
import type { XmlFragment } from "yjs";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import { ensureCardDescFragment, getCards } from "../yjs/schema";
import { useBoardRoom } from "./BoardRoomProvider";

export function CardDescEditor({ cardId }: { cardId: string }) {
  const { doc, awareness, localUser, canEdit } = useBoardRoom();

  // Get-or-create the fragment ONCE on mount (lazy state initializer, not a
  // render-body expression — runs exactly once, never on re-render). The
  // editor only mounts when the card enters edit mode (a user click), so the
  // one-time migration/create write isn't on the board's initial render path;
  // BoardStore reads the doc via useSyncExternalStore, which tolerates it.
  const [fragment] = useState<XmlFragment | null>(() => {
    const card = getCards(doc).get(cardId);
    return card ? ensureCardDescFragment(doc, card) : null;
  });

  const editor = useEditor(
    {
      immediatelyRender: false, // SSR-safe (Next) — verified v3 option
      editable: canEdit,
      autofocus: false,
      extensions: [
        StarterKit.configure({ undoRedo: false }),
        ...(fragment ? [Collaboration.configure({ fragment })] : []),
        // Pass the FULL presence identity — CollaborationCaret overwrites the
        // awareness "user" field on mount, so a partial object here would strip
        // id/image and break cursors/avatars for every peer.
        CollaborationCaret.configure({
          provider: { awareness },
          user: {
            id: localUser.id,
            name: localUser.name,
            color: localUser.color,
            ...(localUser.image ? { image: localUser.image } : {}),
          },
        }),
      ],
      editorProps: {
        attributes: { class: "cc-richtext", "aria-label": "Card description" },
      },
    },
    [fragment, canEdit],
  );

  if (!fragment) return null;
  return <EditorContent editor={editor} />;
}
