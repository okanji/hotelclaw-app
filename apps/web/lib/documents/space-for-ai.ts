"use client";

/**
 * `space` at the start of an empty paragraph opens the inline AI prompt
 * (Liveblocks' `askAi`) — matches the affordance shown by the empty-line
 * placeholder ("Press 'space' for AI or '/' for commands").
 *
 * Only triggers when the cursor is at offset 0 of an empty paragraph; in
 * every other case it falls through to the normal space character insert.
 */

import { Extension } from "@tiptap/core";

export const SpaceForAi = Extension.create({
  name: "spaceForAi",
  addKeyboardShortcuts() {
    return {
      " ": ({ editor }) => {
        const { selection, doc } = editor.state;
        if (!selection.empty) return false;
        const $pos = doc.resolve(selection.from);
        const parent = $pos.parent;
        if (parent.type.name !== "paragraph") return false;
        if (parent.content.size !== 0) return false;
        if ($pos.parentOffset !== 0) return false;
        // Title (first top-level node) — don't intercept there.
        if ($pos.depth >= 1 && $pos.before(1) === 0) return false;
        const askAi = (editor.commands as { askAi?: () => boolean }).askAi;
        if (typeof askAi !== "function") return false;
        return askAi();
      },
    };
  },
});
