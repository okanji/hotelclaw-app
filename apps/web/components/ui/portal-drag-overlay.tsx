"use client";

import { useSyncExternalStore, type ComponentProps } from "react";
import { createPortal } from "react-dom";
import { DragOverlay } from "@dnd-kit/core";

const emptySubscribe = () => () => {};

/** gr8r appearance prefs live as `data-*` on the shell's `.g8` root. */
const APPEARANCE_ATTRS = [
  "data-accent",
  "data-side",
  "data-density",
  "data-motion",
] as const;

function shellAppearance(): Record<string, string> {
  const root = document.querySelector<HTMLElement>(
    ".g8:not(.g8-port):not(.g8-drag)",
  );
  const attrs: Record<string, string> = {};
  for (const name of APPEARANCE_ATTRS) {
    const v = root?.getAttribute(name);
    if (v) attrs[name] = v;
  }
  return attrs;
}

/**
 * dnd-kit `DragOverlay`, portaled to `document.body`.
 *
 * The shell's `sidebar-inset` pane is GPU-promoted with a transform (see
 * app/p/[propertyId]/layout.tsx) to work around a Chrome repaint bug where
 * the pane flashes white on hover. A transformed ancestor becomes the
 * containing block for `position: fixed`, so a DragOverlay rendered inline
 * inside the pane would sit offset from the cursor by the pane's own
 * viewport position. Portaling to <body> keeps the overlay in the
 * viewport's coordinate space regardless of what the shell composites.
 * React context (the surrounding DndContext) flows through the portal, and
 * the overlay's measured rect is viewport-based either way, so collision
 * detection is unaffected.
 *
 * <body> is outside the shell's `.g8` root, and every gr8r rule is scoped
 * under `.g8` — so the overlay renders inside its own `g8 g8-drag` host
 * (carrying the shell's appearance attributes), or a ghost like `.kcard`
 * loses its surface and layout and drags as loose text.
 */
export function PortalDragOverlay(props: ComponentProps<typeof DragOverlay>) {
  // Portals can't render on the server — `false` during SSR/hydration,
  // `true` on every client render after that.
  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
  if (!mounted) return null;
  return createPortal(
    <div className="g8 g8-drag" {...shellAppearance()}>
      <DragOverlay {...props} />
    </div>,
    document.body,
  );
}
