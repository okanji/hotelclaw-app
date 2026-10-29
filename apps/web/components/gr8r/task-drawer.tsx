"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { TaskRoom } from "@/components/tasks/task-room";
import { taskHref } from "@/lib/tasks/task-href";
import {
  TaskDrawerChromeContext,
  type TaskDrawerChrome,
} from "./task-drawer-context";

/**
 * gr8r's task drawer (src/overlays/drawer.js): the task opens in a right-side
 * `.drawer` over whatever view you are on, driven by `?task=<id>`. The
 * TaskDetail inside renders gr8r's `.drawer-h` itself and picks up the
 * drawer's Full page / Open as page / Close buttons through
 * `TaskDrawerChromeContext`.
 *
 * Optional wrapper — mount once inside the `.g8` shell root:
 *   <Suspense fallback={null}><TaskDrawer propertyId={propertyId} /></Suspense>
 * (useSearchParams needs the Suspense boundary). Open a task with
 * `?task=<id>` on the current URL; Esc / the close button strip it.
 *
 * It stays out of the way where `?task=` already means something (Triage's
 * selection) and on the task's own page.
 */
export function TaskDrawer({ propertyId }: { propertyId: string }) {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const taskId = params.get("task");
  const [full, setFull] = useState(false);
  const asideRef = useRef<HTMLElement>(null);

  const suppressed =
    !pathname ||
    /\/triage(?:\/|$)/.test(pathname) ||
    /\/tasks\/[^/]+/.test(pathname);
  const open = Boolean(taskId) && !suppressed;

  const close = useCallback(() => {
    const next = new URLSearchParams(params.toString());
    next.delete("task");
    const qs = next.toString();
    setFull(false);
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [params, pathname, router]);

  // Esc closes — but not while a menu / popover portaled OUTSIDE the drawer
  // owns focus (its own Esc closes it), nor mid-edit in a field, where Esc
  // belongs to the field (the title reverts + blurs; a second Esc closes).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const el = document.activeElement as HTMLElement | null;
      const aside = asideRef.current;
      // A portaled menu / popover / dialog owns its own Esc. Focus merely
      // left on the board (the card that opened the drawer) does not.
      if (
        el &&
        aside &&
        !aside.contains(el) &&
        el.closest('[role="menu"],[role="listbox"],[role="dialog"],[data-slot$="-content"]')
      )
        return;
      // The task's floating details rail closes first (its own Esc handler).
      if (aside?.querySelector(".g8-trail-float")) return;
      if (
        el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.tagName === "SELECT" ||
          el.isContentEditable)
      )
        return;
      close();
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKey, { capture: true });
  }, [open, close]);

  // Focus the dialog on open so Esc / Tab start inside it.
  useEffect(() => {
    if (open) asideRef.current?.focus({ preventScroll: true });
  }, [open, taskId]);

  const chrome = useMemo<TaskDrawerChrome | null>(
    () =>
      taskId
        ? {
            onClose: close,
            expandHref: taskHref(propertyId, taskId),
            full,
            onToggleFull: () => setFull((v) => !v),
          }
        : null,
    [taskId, close, propertyId, full],
  );

  if (!open || !taskId || !chrome) return null;

  return (
    <>
      {full ? (
        <div
          className="drawer-scrim full enter"
          onClick={close}
          aria-hidden="true"
        />
      ) : null}
      <aside
        ref={asideRef}
        key={taskId}
        className={full ? "drawer full enter" : "drawer enter"}
        role="dialog"
        aria-modal={full}
        aria-label="Task"
        tabIndex={-1}
      >
        <TaskDrawerChromeContext.Provider value={chrome}>
          <TaskRoom propertyId={propertyId} taskId={taskId} variant="embedded" />
        </TaskDrawerChromeContext.Provider>
      </aside>
    </>
  );
}
