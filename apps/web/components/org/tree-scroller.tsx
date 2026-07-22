"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * Horizontal scroll frame for the org tree. The tree grows to its natural
 * height on the page (no fixed-height canvas); only the horizontal axis
 * scrolls when a wide branch outruns the viewport.
 *
 * The tree is center-aligned, so a wide chart would otherwise open scrolled to
 * its far-left edge with the root off-screen. We park the scroll on the middle
 * — and re-center while the content is still settling (avatars, fonts, a
 * late-arriving query), since the first measurement is usually stale. As soon
 * as the reader scrolls, they own the position and we stop moving it.
 */
export function TreeScroller({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let readerTookOver = false;
    const center = () => {
      if (readerTookOver) return;
      el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2;
    };
    const takeOver = () => {
      readerTookOver = true;
    };

    center();
    const observer = new ResizeObserver(center);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);

    el.addEventListener("wheel", takeOver, { passive: true });
    el.addEventListener("pointerdown", takeOver);
    el.addEventListener("keydown", takeOver);
    return () => {
      observer.disconnect();
      el.removeEventListener("wheel", takeOver);
      el.removeEventListener("pointerdown", takeOver);
      el.removeEventListener("keydown", takeOver);
    };
  }, []);

  return (
    <div ref={ref} className={cn("overflow-x-auto pb-2", className)}>
      {children}
    </div>
  );
}
