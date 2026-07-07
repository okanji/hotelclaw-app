"use client";

import {
  NodeViewContent,
  NodeViewWrapper,
  type NodeViewProps,
} from "@tiptap/react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Toggle node view. ChevronRight triangle on the left flips state when
 * clicked; the body collapses with CSS only — the prosemirror content
 * stays in the doc either way, just hidden visually.
 *
 * Because the editable content includes both the summary paragraph AND the
 * body, we let prosemirror render the full child sequence inline via
 * `NodeViewContent`. The chevron is positioned absolutely outside the
 * editable area so it doesn't get treated as a content cell.
 */

export function ToggleView({ node, updateAttributes }: NodeViewProps) {
  const open = node.attrs.open !== false;

  return (
    <NodeViewWrapper
      data-type="toggle"
      data-open={String(open)}
      className={cn(
        "toggle group/toggle my-1 grid grid-cols-[24px_1fr] gap-1 rounded-md py-0.5",
        !open && "is-collapsed",
      )}
    >
      <button
        type="button"
        contentEditable={false}
        onClick={() => updateAttributes({ open: !open })}
        className="mt-1.5 flex size-5 select-none items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label={open ? "Collapse" : "Expand"}
      >
        <ChevronRight
          className={cn(
            "size-4 transition-transform",
            open && "rotate-90",
          )}
        />
      </button>
      <NodeViewContent
        className={cn(
          "toggle-content min-w-0",
          // Hide every child after the first when collapsed. The
          // first child (the summary paragraph) is always visible.
          !open && "[&>*:not(:first-child)]:hidden",
        )}
      />
    </NodeViewWrapper>
  );
}
