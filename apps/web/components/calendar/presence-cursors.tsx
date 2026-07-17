"use client";

import { useEffect, useRef } from "react";
import {
  useOthers,
  useUpdateMyPresence,
} from "@liveblocks/react/suspense";

/**
 * Thin overlay that:
 *   * tracks the local pointer inside its bounding box and writes it to
 *     presence (throttled by Liveblocks)
 *   * renders each peer's cursor dot inside the same bounding box
 *
 * Pointer coords are normalised to 0..1 so a peer on a wider monitor
 * still lands at the same logical spot. Mount inside any positioned
 * container — typically the calendar grid wrapper.
 */
export function PresenceCursors() {
  const ref = useRef<HTMLDivElement>(null);
  const others = useOthers();
  const updateMyPresence = useUpdateMyPresence();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    function onMove(e: PointerEvent) {
      const rect = el!.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      if (x < 0 || x > 1 || y < 0 || y > 1) {
        updateMyPresence({ cursor: null });
        return;
      }
      updateMyPresence({ cursor: { x, y } });
    }
    function onLeave() {
      updateMyPresence({ cursor: null });
    }
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);
    return () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
      updateMyPresence({ cursor: null });
    };
  }, [updateMyPresence]);

  return (
    <div ref={ref} className="pointer-events-none absolute inset-0 z-30">
      {others.map((o) => {
        if (!o.presence?.cursor) return null;
        const color = o.info?.color ?? "#7c3aed";
        return (
          <div
            key={o.connectionId}
            className="absolute -translate-x-1/2 -translate-y-1/2 transition-[left,top] duration-75 ease-linear"
            style={{
              left: `${o.presence.cursor.x * 100}%`,
              top: `${o.presence.cursor.y * 100}%`,
            }}
          >
            <svg width="14" height="20" viewBox="0 0 14 20" fill={color}>
              <path d="M0 0 L0 16 L4 12 L7 19 L9 18 L6 11 L12 11 Z" />
            </svg>
            <span
              className="ml-3 inline-block whitespace-nowrap rounded-md px-1.5 py-0.5 text-xs font-medium text-white"
              style={{ backgroundColor: color }}
            >
              {o.info?.name ?? "Anonymous"}
            </span>
          </div>
        );
      })}
    </div>
  );
}
