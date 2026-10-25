"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Check, CircleAlert, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { updateForm } from "./actions";

/**
 * Autosave for the form builder — the studio builder's "no Save button"
 * model on top of our `updateForm` server action.
 *
 * Every edit queues a PATCH (title, description, icon, schema, …). Patches
 * merge, so a burst of edits is one write; typing waits ~1s after the last
 * key, toggles ~400ms. Writes are serialized: an edit made while a save is
 * in flight is queued and goes out right after it, so the last edit always
 * wins. A failed write keeps its patch and the status line offers a retry;
 * the page warns before unload while anything is unsaved, and pending edits
 * flush on unmount.
 *
 * `hold(reason)` marks the working copy as not-yet-savable (a question with
 * no title) without touching what is already queued.
 */

type Patch = Parameters<typeof updateForm>[0]["patch"];

export type SaveState = "idle" | "saving" | "saved" | "error" | "held";

export function useFormAutosave(formId: string) {
  const pending = useRef<Patch>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const running = useRef(false);
  const queued = useRef(false);
  const [state, setState] = useState<SaveState>("idle");
  const [message, setMessage] = useState<string | null>(null);

  const hasPending = () => Object.keys(pending.current).length > 0;
  // `run` re-invokes itself for queued edits; going through a ref keeps the
  // callback stable and avoids a self-reference inside its own declaration.
  const runRef = useRef<() => Promise<void>>(async () => {});

  const run = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (running.current) {
      queued.current = true;
      return;
    }
    if (!hasPending()) return;
    const patch = pending.current;
    pending.current = {};
    running.current = true;
    setState("saving");
    let failed: string | null = null;
    try {
      const result = await updateForm({ formId, patch });
      if ("error" in result) failed = result.error;
    } catch {
      failed = "Couldn't reach the server";
    }
    running.current = false;
    if (failed) {
      // Keep the failed patch underneath anything typed since.
      pending.current = { ...patch, ...pending.current };
      setState("error");
      setMessage(failed);
      toast.error(`Not saved: ${failed}`);
      return;
    }
    if (queued.current || hasPending()) {
      queued.current = false;
      void runRef.current();
      return;
    }
    setState("saved");
    setMessage(null);
  }, [formId]);

  useEffect(() => {
    runRef.current = run;
  }, [run]);

  const queue = useCallback(
    (patch: Patch, delay = 1000) => {
      pending.current = { ...pending.current, ...patch };
      setState((s) => (s === "held" || s === "error" ? "idle" : s));
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void run(), delay);
    },
    [run],
  );

  const hold = useCallback((reason: string) => {
    setState("held");
    setMessage(reason);
  }, []);

  const flush = useCallback(() => void run(), [run]);

  // Leaving with unsaved edits: warn, and flush whatever is queued.
  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (hasPending() || running.current) e.preventDefault();
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      if (timer.current) clearTimeout(timer.current);
      if (hasPending() && !running.current) {
        void updateForm({ formId, patch: pending.current });
        pending.current = {};
      }
    };
  }, [formId]);

  return { queue, hold, flush, state, message };
}

/** The quiet status line beside the page title. */
export function SaveStatus({
  state,
  message,
  onRetry,
  className,
}: {
  state: SaveState;
  message: string | null;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <span
      aria-live="polite"
      className={cn("inline-flex items-center gap-1.5 text-sm text-faint-foreground", className)}
    >
      {state === "saving" ? (
        <>
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          Saving…
        </>
      ) : state === "saved" ? (
        <>
          <Check className="size-3.5 text-success" aria-hidden />
          Saved
        </>
      ) : state === "held" ? (
        <span className="inline-flex items-center gap-1.5 text-warning">
          <CircleAlert className="size-3.5" aria-hidden />
          {message ?? "Waiting to save"}
        </span>
      ) : state === "error" ? (
        <span className="inline-flex items-center gap-1.5 text-destructive">
          <CircleAlert className="size-3.5" aria-hidden />
          Not saved
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="rounded-sm underline underline-offset-2 hover:bg-accent focus-visible:shadow-focus focus-visible:outline-none"
            >
              Retry
            </button>
          ) : null}
        </span>
      ) : (
        "Changes save automatically"
      )}
    </span>
  );
}
