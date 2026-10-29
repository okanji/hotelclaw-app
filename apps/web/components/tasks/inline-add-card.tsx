"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { createTask } from "./actions";

type Props = {
  propertyId: string;
  /** The column's id — a status uuid (list board) or a legacy literal. */
  status: string;
  onCreated: () => void;
  onClose: () => void;
  /** When the board is scoped to a team (`?space=`), quick-adds land there;
      otherwise omit so the server defaults to the creator's home team. */
  scopeSpaceId?: string | null;
  /** When the board is scoped to a list (`?list=`), quick-adds land in it. */
  scopeListId?: string | null;
  /** When the board is a project's, quick-adds join that project. */
  scopeProjectId?: string | null;
  /** Hands off to the full-page create ("Details…"). */
  onOpenFullCreate?: () => void;
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
export function InlineAddCard({
  propertyId,
  status,
  onCreated,
  onClose,
  scopeSpaceId,
  scopeListId,
  scopeProjectId,
  onOpenFullCreate,
}: Props) {
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
        ...(scopeListId ? { listId: scopeListId } : {}),
        ...(scopeProjectId ? { projectId: scopeProjectId } : {}),
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
    // gr8r `.composer` (src/views/board.js): a ringed card with a bare
    // textarea and an Enter / Esc hint row. "Details…" opens the full-page
    // create for a task that needs more up-front.
    <div className="composer">
      <textarea
        autoFocus
        name="quick-add-title"
        aria-label="New task name"
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
        onBlur={(e) => {
          // Moving to the composer's own buttons isn't leaving it.
          if (e.currentTarget.parentElement?.contains(e.relatedTarget as Node | null)) return;
          submit();
        }}
        placeholder="Task name"
        disabled={pending}
      />
      <div className="row">
        <span className="faint" style={{ fontSize: 11 }}>
          {pending ? "Adding…" : "Enter to add · Esc to cancel"}
        </span>
        <span className="sp" />
        {onOpenFullCreate ? (
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onMouseDown={(e) => e.preventDefault()}
            onClick={onOpenFullCreate}
            title="Open the full editor"
          >
            Details…
          </button>
        ) : null}
        <button
          type="button"
          className="btn btn-sm btn-primary"
          onMouseDown={(e) => e.preventDefault()}
          onClick={submit}
          disabled={pending}
        >
          Add
        </button>
      </div>
    </div>
  );
}
