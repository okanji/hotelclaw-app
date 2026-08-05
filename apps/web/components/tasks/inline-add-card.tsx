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
  /** When the board is scoped to a team (`?space=`), quick-adds land there;
      otherwise omit so the server defaults to the creator's home team. */
  scopeSpaceId?: string | null;
};

/**
 * Inline quick-add — the fast path for the common "type a title, hit Enter"
 * case. The full-page create experience (`TaskCreatePage`, opened from the
 * header "New task" button / column "+") is there for tasks that need a
 * description, priority, assignee, or team up-front.
 *
 * Enter submits, Shift+Enter inserts a newline, Esc cancels. Blurring with
 * an empty title cancels; blurring with content submits (mirrors Linear /
 * Notion behavior so casual creators don't lose what they typed).
 */
export function InlineAddCard({ propertyId, status, onCreated, onClose, scopeSpaceId }: Props) {
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
        // Scoped board → that team; unscoped → omit (server defaults to the
        // creator's home team).
        ...(scopeSpaceId ? { spaceId: scopeSpaceId } : {}),
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
      // Active composer: the ONE case where a resting surface earns a visible
      // edge, because it is the focused thing on the board. Ring only — no
      // stroke, no elevation.
      className={cn("rounded-card bg-card px-2.5 py-2 shadow-focus")}
    >
      <Textarea
        bare
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
        className="min-h-0 resize-none px-1 py-1 text-sm leading-[1.125rem]"
      />
      <div className="mt-1 flex items-center justify-between px-1 pb-0.5 text-xs text-faint-foreground">
        <span className="text-faint-foreground">
          <kbd className="font-sans">Enter</kbd> to add ·{" "}
          <kbd className="font-sans">Esc</kbd> to cancel
        </span>
        {pending ? <span>Adding…</span> : null}
      </div>
    </div>
  );
}
