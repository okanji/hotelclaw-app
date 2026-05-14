"use client";

import { createContext, forwardRef, useContext } from "react";
import { Composer as LBComposer } from "@liveblocks/react-ui";
import type { ComposerProps } from "@liveblocks/react-ui";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Plumbs a `closeComposer()` callback into the custom Composer renderer so
 * the X button can dismiss the pending comment without re-binding the editor
 * on every render of the parent.
 */
export const ComposerCloseContext = createContext<(() => void) | null>(null);

/**
 * Custom Composer for `<FloatingComposer components={{ Composer }} />`.
 *
 * Wraps Liveblocks's default `Composer` with a slim header bar that holds
 * the X close button. The header style matches the editor toolbar (subtle
 * muted fill, thin bottom border) so the popover reads like a small
 * sub-window of the document.
 */
export const DocumentComposer = forwardRef<HTMLFormElement, ComposerProps>(
  function DocumentComposer(props, ref) {
    const onClose = useContext(ComposerCloseContext);

    return (
      <div className="flex flex-col">
        <PopoverHeader onClose={onClose} />
        <LBComposer {...props} ref={ref} />
      </div>
    );
  },
);

/**
 * Slim header across the top of the comment popovers. Same fill as the
 * editor's toolbar so it reads as a sibling chrome row. Holds only the X
 * close button — no title (the popover content makes the context obvious).
 */
export function PopoverHeader({ onClose }: { onClose: (() => void) | null }) {
  return (
    <div className="flex items-center justify-end gap-2 border-b border-border bg-muted/40 px-2 py-1">
      {onClose ? (
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          title="Close"
          className={cn(
            "inline-flex size-6 items-center justify-center rounded-md",
            "text-muted-foreground transition-colors",
            "hover:bg-accent hover:text-accent-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          <X className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}
