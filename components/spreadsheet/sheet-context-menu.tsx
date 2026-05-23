"use client";

/**
 * Cell context menu — opens on right-click. A simple absolute-positioned
 * panel; outside-click closes. We don't use Base UI's Menu primitive here
 * because that ties to a trigger element; right-click can land on any of
 * a few thousand cells and shows at the click point.
 */

import { useEffect, useRef } from "react";

export type ContextMenuAction = {
  label: string;
  shortcut?: string;
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
};

export type ContextMenuSection = {
  label?: string;
  items: ContextMenuAction[];
};

export function SheetContextMenu({
  x,
  y,
  sections,
  onClose,
}: {
  x: number;
  y: number;
  sections: ContextMenuSection[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onPointer(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    // Defer one tick so the right-click that opened the menu doesn't
    // immediately close it.
    const t = setTimeout(() => {
      window.addEventListener("mousedown", onPointer);
      window.addEventListener("keydown", onKey);
    }, 0);
    return () => {
      clearTimeout(t);
      window.removeEventListener("mousedown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // Clamp to viewport so the menu never opens off-screen.
  const maxX = typeof window !== "undefined" ? window.innerWidth - 220 : x;
  const maxY = typeof window !== "undefined" ? window.innerHeight - 320 : y;
  const safeX = Math.min(x, Math.max(0, maxX));
  const safeY = Math.min(y, Math.max(0, maxY));

  return (
    <div
      ref={ref}
      role="menu"
      className="fixed z-50 min-w-[200px] rounded-md border border-border/60 bg-popover py-1 shadow-lg ring-1 ring-foreground/5"
      style={{ left: safeX, top: safeY }}
    >
      {sections.map((section, si) => (
        <div key={si} className={si > 0 ? "border-t border-border/40" : ""}>
          {section.label ? (
            <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
              {section.label}
            </div>
          ) : null}
          {section.items.map((item, ii) => (
            <button
              key={ii}
              type="button"
              disabled={item.disabled}
              onClick={() => {
                if (item.disabled) return;
                item.onClick();
                onClose();
              }}
              className={
                "flex w-full items-center justify-between px-3 py-1.5 text-left text-[12.5px] " +
                (item.disabled
                  ? "cursor-not-allowed text-muted-foreground"
                  : item.destructive
                    ? "text-destructive hover:bg-muted"
                    : "text-foreground hover:bg-muted")
              }
            >
              <span>{item.label}</span>
              {item.shortcut ? (
                <kbd className="ml-3 font-mono text-[10px] text-muted-foreground">
                  {item.shortcut}
                </kbd>
              ) : null}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
