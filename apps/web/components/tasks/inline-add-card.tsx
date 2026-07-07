"use client";

import { useRef, useState, useTransition } from "react";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { createTask } from "./actions";
import type { TaskStatus } from "@/lib/db/types";

type Props = {
  propertyId: string;
  status: TaskStatus;
  onCreated: () => void;
  onClose: () => void;
};

/**
 * Inline quick-add — replaces the modal for the common "type a title, hit
 * Enter" case. The full `CreateTaskDialog` is still available from the page
 * header for tasks that need a description, priority, or assignee up-front.
 *
 * Enter submits, Shift+Enter inserts a newline, Esc cancels. Blurring with
 * an empty title cancels; blurring with content submits (mirrors Linear /
 * Notion behavior so casual creators don't lose what they typed).
 */
export function InlineAddCard({ propertyId, status, onCreated, onClose }: Props) {
  const [title, setTitle] = useState("");
  const [pending, startTransition] = useTransition();
  // After a successful create we briefly skip the textarea's onBlur side-
  // effects so the close-then-cleanup doesn't double-fire.
  const submittedRef = useRef(false);

  function submit() {
    if (submittedRef.current) return;
    const trimmed = title.trim();
    if (!trimmed) {
      onClose();
      return;
    }
    submittedRef.current = true;
    startTransition(async () => {
      const result = await createTask({
        propertyId,
        title: trimmed,
        status,
        // New quick-add tasks start unprioritised — same as Linear and the
        // full create dialog default.
        priority: "none",
      });
      if ("error" in result) {
        toast.error(result.error);
        submittedRef.current = false;
        return;
      }
      onCreated();
      onClose();
    });
  }

  return (
    <div
      className={cn(
        "rounded-md border border-primary/40 bg-card p-2 shadow-xs",
        "ring-1 ring-primary/15 dark:ring-primary/20",
      )}
    >
      <Textarea
        autoFocus
        name="quick-add-title"
        aria-label="New task title"
        rows={2}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          }
        }}
        onBlur={submit}
        placeholder="Task title…"
        disabled={pending}
        className="min-h-0 resize-none border-0 bg-transparent px-1 py-1 text-sm leading-[1.125rem] shadow-none focus-visible:ring-0"
      />
      <div className="mt-1 flex items-center justify-between px-1 pb-0.5 text-xs text-muted-foreground">
        <span className="tracking-tight">
          <kbd className="font-sans">Enter</kbd> to add ·{" "}
          <kbd className="font-sans">Esc</kbd> to cancel
        </span>
        {pending ? <span>Adding…</span> : null}
      </div>
    </div>
  );
}
