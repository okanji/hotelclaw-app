"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Maximize, Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

// A lightweight pan/zoom viewport for the Flow builder. Pan and zoom are driven
// entirely by wheel/gesture events — two-finger trackpad scroll pans (deltaX/Y),
// pinch (or ctrl/⌘ + wheel) zooms around the cursor — so it never competes with
// the pointer-based dnd-kit drag inside it. The content is translated+scaled via
// a single transform; overlays (inspector, palette, drag clone) are portalled to
// <body>, so they live outside the transform and stay crisp.

const MIN_ZOOM = 0.4;
const MAX_ZOOM = 2;

// Base spacing of the dot grid in world units. Scaled by zoom and offset by the
// pan so the dots stay locked to the content (React Flow's background trick).
const DOT_GAP = 22;

type Transform = { x: number; y: number; z: number };

const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

export function PanZoomCanvas({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [t, setT] = useState<Transform>({ x: 48, y: 32, z: 1 });

  // `will-change: transform` promotes the content to its own GPU layer, which
  // the compositor rasterizes once at 1× and then stretches — so zooming in
  // blurs the cards. We only want that layer during an active gesture (for
  // smooth pan/zoom); at rest we drop it so the browser re-rasterizes at the
  // current scale and text stays crisp.
  const [interacting, setInteracting] = useState(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bumpInteracting = useCallback(() => {
    setInteracting(true);
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setInteracting(false), 200);
  }, []);
  useEffect(() => () => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
  }, []);

  const zoomAround = useCallback((clientX: number, clientY: number, factor: number) => {
    const vp = viewportRef.current;
    if (!vp) return;
    const rect = vp.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    setT((cur) => {
      const z = clampZoom(cur.z * factor);
      if (z === cur.z) return cur;
      // Keep the world point under the cursor fixed while zooming.
      const wx = (px - cur.x) / cur.z;
      const wy = (py - cur.y) / cur.z;
      return { x: px - wx * z, y: py - wy * z, z };
    });
  }, []);

  // Wheel must be a non-passive listener so we can preventDefault the page
  // scroll/zoom — React's onWheel is passive, so attach it manually.
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      bumpInteracting();
      if (e.ctrlKey || e.metaKey) {
        zoomAround(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.01));
      } else {
        setT((c) => ({ ...c, x: c.x - e.deltaX, y: c.y - e.deltaY }));
      }
    };
    vp.addEventListener("wheel", onWheel, { passive: false });
    return () => vp.removeEventListener("wheel", onWheel);
  }, [zoomAround, bumpInteracting]);

  const fit = useCallback(() => {
    const vp = viewportRef.current;
    const content = contentRef.current;
    if (!vp || !content) return;
    const cw = content.scrollWidth;
    const ch = content.scrollHeight;
    if (!cw || !ch) return;
    const z = clampZoom(Math.min(vp.clientWidth / (cw + 96), vp.clientHeight / (ch + 96), 1));
    setT({
      x: Math.max(24, (vp.clientWidth - cw * z) / 2),
      y: Math.max(24, (vp.clientHeight - ch * z) / 2),
      z,
    });
  }, []);

  // Fit once, as soon as the content has measurable size.
  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    let done = false;
    const ro = new ResizeObserver(() => {
      if (!done && content.scrollWidth > 0) {
        done = true;
        fit();
      }
    });
    ro.observe(content);
    return () => ro.disconnect();
  }, [fit]);

  // External pan requests (e.g. jumping to a branch lane from the inspector).
  useEffect(() => {
    const onPanTo = (e: Event) => {
      const selector = (e as CustomEvent<{ selector: string }>).detail?.selector;
      const vp = viewportRef.current;
      const content = contentRef.current;
      if (!selector || !vp || !content) return;
      const el = content.querySelector(selector);
      if (!el) return;

      const elRect = el.getBoundingClientRect();
      const vpRect = vp.getBoundingClientRect();
      const elCx = elRect.left + elRect.width / 2;
      const elCy = elRect.top + elRect.height / 2;
      const vpCx = vpRect.left + vpRect.width / 2;
      const vpCy = vpRect.top + vpRect.height / 2;

      setT((cur) => ({
        ...cur,
        x: cur.x + (vpCx - elCx),
        y: cur.y + (vpCy - elCy),
      }));
    };
    window.addEventListener("workflow:pan-to", onPanTo);
    return () => window.removeEventListener("workflow:pan-to", onPanTo);
  }, []);

  const zoomBy = useCallback(
    (factor: number) => {
      const vp = viewportRef.current;
      if (!vp) return;
      const rect = vp.getBoundingClientRect();
      bumpInteracting();
      zoomAround(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
    },
    [zoomAround, bumpInteracting],
  );

  return (
    <div
      ref={viewportRef}
      className={cn(
        "relative h-full w-full overflow-hidden [overscroll-behavior:contain] [touch-action:none]",
        className,
      )}
    >
      {/* Dot grid — locked to the content: position follows the pan, size
          follows the zoom. Sits below the content and ignores pointer events. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 [background-image:radial-gradient(circle,var(--border)_1px,transparent_1px)]"
        style={{
          backgroundSize: `${DOT_GAP * t.z}px ${DOT_GAP * t.z}px`,
          backgroundPosition: `${t.x}px ${t.y}px`,
        }}
      />

      <div
        ref={contentRef}
        className="absolute top-0 left-0 origin-top-left"
        style={{
          transform: `translate(${t.x}px, ${t.y}px) scale(${t.z})`,
          willChange: interacting ? "transform" : "auto",
        }}
      >
        {children}
      </div>

      <div className="absolute right-3 bottom-3 z-10 flex items-center gap-px rounded-lg border border-border/60 bg-card/90 p-0.5 shadow-sm backdrop-blur">
        <ZoomButton label="Zoom out" onClick={() => zoomBy(1 / 1.2)}>
          <Minus className="size-3.5" />
        </ZoomButton>
        <button
          type="button"
          onClick={fit}
          title="Reset zoom"
          className="min-w-11 rounded-md px-1.5 py-1 text-xs font-medium tabular-nums text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          {Math.round(t.z * 100)}%
        </button>
        <ZoomButton label="Zoom in" onClick={() => zoomBy(1.2)}>
          <Plus className="size-3.5" />
        </ZoomButton>
        <span className="mx-0.5 h-4 w-px bg-border/60" aria-hidden />
        <ZoomButton label="Fit to view" onClick={fit}>
          <Maximize className="size-3.5" />
        </ZoomButton>
      </div>
    </div>
  );
}

function ZoomButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      {children}
    </button>
  );
}
