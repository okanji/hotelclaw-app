"use client";

import { useSyncExternalStore, type ComponentProps } from "react";
import { createPortal } from "react-dom";
import { DragOverlay } from "@dnd-kit/core";

const emptySubscribe = () => () => {};

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
  return createPortal(<DragOverlay {...props} />, document.body);
}
