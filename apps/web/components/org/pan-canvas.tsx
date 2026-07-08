"use client";

import { useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * A bounded, scrollable canvas. Two-finger trackpad scrolling pans it in both
 * axes natively (the content is wider/taller than the frame); dragging from an
 * empty area grab-pans for mouse users. Drags that start on an interactive
 * element (link, button, input, the edit popover) are left alone so those keep
 * working.
 */
export function PanCanvas({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    x: number;
    y: number;
    left: number;
    top: number;
  } | null>(null);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    // Don't hijack interactive descendants.
    if (
      (e.target as HTMLElement).closest(
        "a,button,input,select,textarea,[data-slot='popover-content']",
      )
    ) {
      return;
    }
    const el = ref.current;
    if (!el) return;
    drag.current = {
      x: e.clientX,
      y: e.clientY,
      left: el.scrollLeft,
      top: el.scrollTop,
    };
    el.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    const el = ref.current;
    if (!d || !el) return;
    el.scrollLeft = d.left - (e.clientX - d.x);
    el.scrollTop = d.top - (e.clientY - d.y);
  }

  function endDrag(e: React.PointerEvent<HTMLDivElement>) {
    if (drag.current && ref.current) {
      ref.current.releasePointerCapture(e.pointerId);
    }
    drag.current = null;
  }

  return (
    <div
      ref={ref}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      className={cn(
        "relative overflow-auto overscroll-contain rounded-lg border border-border bg-muted/10",
        "cursor-grab active:cursor-grabbing [&_a]:cursor-pointer [&_button]:cursor-pointer",
        className,
      )}
    >
      {children}
    </div>
  );
}
