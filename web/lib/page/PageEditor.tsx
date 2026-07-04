"use client";

/**
 * PageEditor (N2) — full-page collaborative TipTap editor bound to the page
 * doc's default Y.XmlFragment. Lives in lib/page (the Yjs seam). Same extension
 * set + caret rules as CardDescEditor, styled full-width.
 */

import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import { usePageRoom } from "./PageRoomProvider";

export function PageEditor() {
  const { doc, awareness, localUser, canEdit } = usePageRoom();

  const editor = useEditor({
    immediatelyRender: false,
    editable: canEdit,
    autofocus: false,
    extensions: [
      StarterKit.configure({ undoRedo: false }),
      Collaboration.configure({ document: doc }),
      // Full identity — CollaborationCaret overwrites the awareness "user"
      // field on mount; a partial object would break presence (see N1).
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
      attributes: { class: "cc-page-doc", "aria-label": "Page content" },
    },
  });

  return <EditorContent editor={editor} />;
}
