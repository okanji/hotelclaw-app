"use client";

import { useEffect } from "react";

/**
 * App-wide tooltips for ICON buttons, mounted once in the root layout.
 *
 * Every icon-only control in the app already names itself — `aria-label`
 * and/or `title` — but a native `title` shows late, unstyled, and never on
 * keyboard focus. Wrapping hundreds of buttons in `<Tooltip>` would drift,
 * so this delegates instead: hover (or keyboard-focus) a button / link /
 * `[role=button]` whose visible text has no letters (an icon, maybe with a
 * count) and its label shows in the house tooltip (same look as
 * `TooltipContent` — gr8r's inverted `[data-tip]` slab).
 *
 * - Label = `aria-label` › `title` › `data-auto-tip`. The native `title` is
 *   moved to `data-auto-tip` on first hover so the browser's own tooltip
 *   doesn't double up (the element keeps its accessible name via aria-label,
 *   or gets one copied from the title).
 * - Skipped: anything with an explicit `<Tooltip>` (`data-slot=tooltip-trigger`),
 *   gr8r's CSS `[data-tip]`, and subtrees marked `data-no-auto-tip`.
 * - Dev only: an icon-only control with NO label logs one warning, so
 *   unlabeled buttons surface while you click around.
 */

const DELAY_MS = 350;
const TARGETS = 'button, a[href], [role="button"], [role="tab"], [role="menuitem"]';

function isIconOnly(el: HTMLElement): boolean {
  return !/\p{L}/u.test(el.innerText ?? "");
}

function labelOf(el: HTMLElement): string | null {
  const title = el.getAttribute("title");
  if (title) {
    el.setAttribute("data-auto-tip", title);
    el.removeAttribute("title");
    if (!el.getAttribute("aria-label") && !el.getAttribute("aria-labelledby")) {
      el.setAttribute("aria-label", title);
    }
  }
  return (
    el.getAttribute("data-auto-tip") || el.getAttribute("aria-label") || null
  )?.trim() || null;
}

function targetOf(node: EventTarget | null): HTMLElement | null {
  if (!(node instanceof Element)) return null;
  const el = node.closest<HTMLElement>(TARGETS);
  if (!el) return null;
  if (
    el.closest("[data-no-auto-tip]") ||
    el.matches('[data-slot="tooltip-trigger"], [data-tip]') ||
    !isIconOnly(el)
  ) {
    return null;
  }
  return el;
}

const warned = new WeakSet<Element>();

export function AutoTooltips() {
  useEffect(() => {
    const tip = document.createElement("div");
    tip.setAttribute("role", "tooltip");
    tip.setAttribute("data-slot", "tooltip-content");
    tip.className =
      "pointer-events-none fixed z-[1000] w-max max-w-xs rounded-[5px] bg-tooltip-bg px-[7px] py-[5px] text-[11px]/none font-medium text-tooltip-foreground animate-[g-fade_120ms_both]";
    tip.hidden = true;
    document.body.appendChild(tip);

    let current: HTMLElement | null = null;
    let timer: number | undefined;

    function hide() {
      window.clearTimeout(timer);
      if (current) current.removeAttribute("aria-describedby");
      current = null;
      tip.hidden = true;
    }

    function place(el: HTMLElement) {
      const r = el.getBoundingClientRect();
      const t = tip.getBoundingClientRect();
      const gap = 6;
      // Below by default (gr8r's [data-tip]); above when there is no room.
      let top = r.bottom + gap;
      if (top + t.height > window.innerHeight - 4) top = r.top - gap - t.height;
      let left = r.left + r.width / 2 - t.width / 2;
      left = Math.max(4, Math.min(left, window.innerWidth - t.width - 4));
      tip.style.top = `${Math.round(top)}px`;
      tip.style.left = `${Math.round(left)}px`;
    }

    function show(el: HTMLElement, immediate: boolean) {
      const label = labelOf(el);
      if (!label) {
        if (process.env.NODE_ENV !== "production" && !warned.has(el)) {
          warned.add(el);
          console.warn("[auto-tooltip] icon-only control has no aria-label/title:", el);
        }
        return;
      }
      hide();
      current = el;
      timer = window.setTimeout(
        () => {
          if (current !== el || !el.isConnected) return;
          tip.textContent = label;
          tip.id = "auto-tooltip";
          el.setAttribute("aria-describedby", "auto-tooltip");
          tip.hidden = false;
          place(el);
        },
        immediate ? 0 : DELAY_MS,
      );
    }

    function onOver(e: PointerEvent) {
      if (e.pointerType === "touch") return;
      const el = targetOf(e.target);
      if (el === current) return;
      if (!el) return hide();
      show(el, !tip.hidden);
    }
    function onOut(e: PointerEvent) {
      if (!current) return;
      const to = e.relatedTarget;
      if (to instanceof Node && current.contains(to)) return;
      hide();
    }
    function onFocus(e: FocusEvent) {
      const el = targetOf(e.target);
      if (el && el.matches(":focus-visible")) show(el, false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") hide();
    }

    document.addEventListener("pointerover", onOver);
    document.addEventListener("pointerout", onOut);
    document.addEventListener("pointerdown", hide, true);
    document.addEventListener("focusin", onFocus);
    document.addEventListener("focusout", hide);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("blur", hide);
    return () => {
      hide();
      tip.remove();
      document.removeEventListener("pointerover", onOver);
      document.removeEventListener("pointerout", onOut);
      document.removeEventListener("pointerdown", hide, true);
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("focusout", hide);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("blur", hide);
    };
  }, []);
  return null;
}
