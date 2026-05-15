"use client";

import { useCallback, useRef, useState } from "react";

const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // one year

type Bounds = { min: number; max: number; fallback: number };

/**
 * Drag-to-resize width for the secondary sidebar. Width is clamped to
 * `[min, max]` and persisted to a cookie on drag-end (read server-side in the
 * property layout so the first paint already matches).
 *
 * `cookieName` lets sections persist independent widths — e.g. Activity keeps
 * its own (wider) width separate from the chat/tasks/docs sidebar.
 *
 * Spread `handleProps` onto a `cursor-col-resize` element on the sidebar's
 * trailing edge.
 */
export function useResizableWidth(
  initial: number | undefined,
  { min, max, fallback }: Bounds,
  cookieName = "section_sidebar_width",
) {
  const clamp = useCallback(
    (w: number) => Math.min(max, Math.max(min, Math.round(w))),
    [min, max],
  );

  const [width, setWidth] = useState(() =>
    clamp(typeof initial === "number" && Number.isFinite(initial) ? initial : fallback),
  );
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ startX: number; startWidth: number; latest: number } | null>(
    null,
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      drag.current = { startX: e.clientX, startWidth: width, latest: width };
      e.currentTarget.setPointerCapture(e.pointerId);
      document.body.style.userSelect = "none";
      setDragging(true);
    },
    [width],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const next = clamp(d.startWidth + (e.clientX - d.startX));
      d.latest = next;
      setWidth(next);
    },
    [clamp],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      drag.current = null;
      setDragging(false);
      document.body.style.userSelect = "";
      e.currentTarget.releasePointerCapture(e.pointerId);
      document.cookie = `${cookieName}=${d.latest}; path=/; max-age=${COOKIE_MAX_AGE}; samesite=lax`;
    },
    [cookieName],
  );

  return {
    width,
    dragging,
    handleProps: { onPointerDown, onPointerMove, onPointerUp },
  };
}
