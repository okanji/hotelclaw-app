"use client";

/**
 * Drop-in replacement for `@tiptap/extension-list`'s default TaskItem that
 * renders the checkbox via shadcn's `Checkbox` so spacing/colors track the
 * rest of the app. The list itself is still handled by `TaskList` from the
 * `@tiptap/extension-list` package — only the per-item view changes here.
 *
 * Modeled on the example repo's `CustomTaskItem.tsx`:
 *   https://github.com/liveblocks/liveblocks/blob/main/examples/nextjs-tiptap-advanced/src/components/CustomTaskItem.tsx
 */

import { TaskItem } from "@tiptap/extension-list";
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";

export const DocumentTaskItem = TaskItem.extend({
  addNodeView() {
    return ReactNodeViewRenderer(TaskItemView);
  },
});

function TaskItemView({
  node,
  updateAttributes,
  editor,
}: {
  node: { attrs: { checked?: boolean } };
  updateAttributes: (attrs: { checked: boolean }) => void;
  editor: { isEditable: boolean };
}) {
  const checked = !!node.attrs.checked;
  return (
    <NodeViewWrapper
      className="flex items-start gap-2 my-1"
      data-checked={checked || undefined}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={!editor.isEditable}
        onChange={(e) => updateAttributes({ checked: e.target.checked })}
        className="mt-[5px] size-4 cursor-pointer rounded-md accent-ring"
      />
      <NodeViewContent className="flex-1 [&_p]:my-0" />
    </NodeViewWrapper>
  );
}
