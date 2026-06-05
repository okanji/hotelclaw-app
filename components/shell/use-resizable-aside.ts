"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // one year

/**
 * Spring constants ported 1:1 from the rail/aside prototype's collapse
 * animation. When the aside is released below its `min` width it springs shut
 * toward 0 with this curve, then hands off to `onCollapse`.
 */
const SPRING = {
  stiffness: 420,
  damping: 30,
  mass: 1,
  restDistance: 0.4,
  restVelocity: 0.4,
  maxDuration: 800,
};

/** Narrowest width the aside tracks the pointer to before release. Lets the
 *  content fade visibly in the "too small" zone before the user commits. */
const DRAG_FLOOR = 56;

type Bounds = { min: number; max: number; fallback: number };

type Options = {
  cookieName?: string;
  /** Called once the spring-collapse settles — hides the aside entirely. */
  onCollapse: () => void;
};

type DragState = { startX: number; startWidth: number; latest: number };

/**
 * Drag-to-resize for the secondary sidebar, with the prototype's
 * spring-collapse: while dragging below `min` the content fades (`tooSmall`),
 * and releasing there springs the width to zero (`collapsing`, which the
 * content blurs against) before calling `onCollapse`. Released at or above
 * `min`, the width clamps to `[min, max]` and persists to a cookie (read
 * server-side so first paint matches).
 *
 * Spread `handleProps` onto a `cursor-col-resize` element on the trailing edge.
 */
export function useResizableAside(
  initial: number | undefined,
  { min, max, fallback }: Bounds,
  { cookieName = "section_sidebar_width", onCollapse }: Options,
) {
  const clamp = useCallback(
    (w: number) => Math.min(max, Math.max(min, Math.round(w))),
    [min, max],
  );

  const [width, setWidth] = useState(() =>
    clamp(
      typeof initial === "number" && Number.isFinite(initial) ? initial : fallback,
    ),
  );
  const [dragging, setDragging] = useState(false);
  const [tooSmall, setTooSmall] = useState(false);
  const [collapsing, setCollapsing] = useState(false);

  const drag = useRef<DragState | null>(null);
  const raf = useRef<number | null>(null);

  const cancelAnim = useCallback(() => {
    if (raf.current !== null) {
      cancelAnimationFrame(raf.current);
      raf.current = null;
    }
  }, []);

  // Cancel any in-flight collapse animation if the host unmounts mid-spring.
  useEffect(() => cancelAnim, [cancelAnim]);

  /** Spring the width to zero, then restore to `restoreWidth` for the next
   *  open and hand off to `onCollapse`. */
  const runCollapse = useCallback(
    (fromWidth: number, restoreWidth: number) => {
      cancelAnim();
      setCollapsing(true);
      let pos = fromWidth;
      let vel = 0;
      let last: number | null = null;
      const start = performance.now();

      const step = (now: number) => {
        if (last === null) last = now;
        const dt = Math.min((now - last) / 1000, 0.064);
        last = now;
        const accel =
          (-SPRING.stiffness * pos - SPRING.damping * vel) / SPRING.mass;
        vel += accel * dt;
        pos += vel * dt;
        setWidth(Math.max(0, pos));

        const atRest =
          Math.abs(pos) < SPRING.restDistance &&
          Math.abs(vel) < SPRING.restVelocity;
        const timedOut = now - start > SPRING.maxDuration;

        if (!atRest && !timedOut) {
          raf.current = requestAnimationFrame(step);
          return;
        }
        raf.current = null;
        setCollapsing(false);
        setTooSmall(false);
        setWidth(clamp(restoreWidth));
        onCollapse();
      };
      raf.current = requestAnimationFrame(step);
    },
    [cancelAnim, clamp, onCollapse],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      cancelAnim();
      drag.current = { startX: e.clientX, startWidth: width, latest: width };
      e.currentTarget.setPointerCapture(e.pointerId);
      document.body.style.userSelect = "none";
      setDragging(true);
    },
    [width, cancelAnim],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const raw = d.startWidth + (e.clientX - d.startX);
      const next = Math.min(max, Math.max(DRAG_FLOOR, Math.round(raw)));
      d.latest = next;
      setWidth(next);
      setTooSmall(next < min);
    },
    [max, min],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      drag.current = null;
      setDragging(false);
      document.body.style.userSelect = "";
      e.currentTarget.releasePointerCapture(e.pointerId);
      if (d.latest < min) {
        // Released in the too-small zone — spring shut, restoring to the width
        // they started this drag from when the aside is next reopened.
        runCollapse(d.latest, d.startWidth);
      } else {
        setTooSmall(false);
        document.cookie = `${cookieName}=${d.latest}; path=/; max-age=${COOKIE_MAX_AGE}; samesite=lax`;
      }
    },
    [min, cookieName, runCollapse],
  );

  return {
    width,
    dragging,
    tooSmall,
    collapsing,
    handleProps: { onPointerDown, onPointerMove, onPointerUp },
  };
}
