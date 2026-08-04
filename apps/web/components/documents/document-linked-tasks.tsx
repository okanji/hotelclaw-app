"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Link2, Plus, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { StatusIcon } from "@/components/tasks/task-icons";
import type { TaskStatus } from "@/lib/db/types";
import {
  documentLinkedTasksQueryOptions,
  tasksQueryOptions,
} from "@/lib/query/section-queries";
import {
  linkTaskDocument,
  unlinkTaskDocument,
} from "@/components/tasks/task-detail-actions";

/**
 * "Linked tasks" affordance for the document header — the document side of the
 * bi-directional doc↔task link. The task side (task detail sidebar) already
 * shows a task's linked docs; this shows the inverse and lets the user attach
 * or detach tasks from inside the doc. Both edit the same `task_document_links`
 * rows, so a change here shows up on the task and vice-versa.
 */
export function DocumentLinkedTasks({
  propertyId,
  documentId,
}: {
  propertyId: string;
  documentId: string;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);

  const { data: linked = [] } = useQuery(
    documentLinkedTasksQueryOptions(propertyId, documentId),
  );
  // Only fetch the full task list once the picker is opened.
  const { data: allTasks = [] } = useQuery({
    ...tasksQueryOptions(propertyId),
    enabled: adding,
  });

  const linkedTaskIds = useMemo(
    () => new Set(linked.map((t) => t.id)),
    [linked],
  );
  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allTasks
      .filter((t) => !linkedTaskIds.has(t.id))
      .filter((t) => (q ? t.title.toLowerCase().includes(q) : true))
      .slice(0, 8);
  }, [allTasks, linkedTaskIds, query]);

  function refresh(taskId?: string) {
    void queryClient.invalidateQueries({
      queryKey: ["doc-linked-tasks", propertyId, documentId],
    });
    if (taskId) {
      void queryClient.invalidateQueries({
        queryKey: ["task-meta", propertyId, taskId],
      });
    }
  }

  async function handleLink(taskId: string) {
    if (busy) return;
    setBusy(true);
    const res = await linkTaskDocument({ taskId, documentId });
    setBusy(false);
    if ("error" in res) {
      toast.error(res.error);
      return;
    }
    setQuery("");
    setAdding(false);
    refresh(taskId);
  }

  async function handleUnlink(linkId: string, taskId: string) {
    if (busy) return;
    setBusy(true);
    const res = await unlinkTaskDocument(linkId);
    setBusy(false);
    if ("error" in res) {
      toast.error(res.error);
      return;
    }
    refresh(taskId);
  }

  const count = linked.length;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setAdding(false);
          setQuery("");
        }
      }}
    >
      <PopoverTrigger
        render={
          <button
            type="button"
            title="Linked tasks"
            className={cn(
              "flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors hover:bg-accent",
              count > 0 ? "text-foreground" : "text-muted-foreground",
            )}
          />
        }
      >
        <Link2 className="size-3.5" />
        <span className="tabular-nums">{count > 0 ? count : "Link"}</span>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} className="w-72 p-0">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-xs leading-3 font-medium text-faint-foreground">
            Linked tasks
          </span>
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent"
          >
            <Plus className="size-3.5" />
            Add
          </button>
        </div>

        {adding ? (
          <div className="border-b border-border p-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-faint-foreground" />
              <Input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search tasks…"
                className="h-8 pl-8 text-sm"
              />
            </div>
            <ul className="mt-1.5 max-h-56 overflow-y-auto">
              {candidates.length === 0 ? (
                <li className="px-2 py-3 text-center text-sm text-muted-foreground">
                  No matching tasks
                </li>
              ) : (
                candidates.map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleLink(t.id)}
                      className="flex w-full items-center gap-2 min-h-7 rounded-md px-1.5 py-[3px] text-left text-sm/[1.2] transition-colors hover:bg-accent disabled:opacity-60"
                    >
                      <StatusIcon
                        status={t.status as TaskStatus}
                        className="size-3.5 shrink-0"
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {t.title || "Untitled task"}
                      </span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>
        ) : null}

        <div className="max-h-64 overflow-y-auto p-1.5">
          {count === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-pretty text-muted-foreground">
              No tasks linked yet. Use{" "}
              <span className="font-medium text-foreground">Add</span> to connect
              this doc to work.
            </p>
          ) : (
            <ul className="flex flex-col">
              {linked.map((t) => (
                <li key={t.linkId} className="group/row flex items-center gap-1">
                  <Link
                    href={`/p/${propertyId}/tasks/${t.id}`}
                    className="flex min-w-0 flex-1 items-center gap-2 min-h-7 rounded-md px-1.5 py-[3px] text-sm/[1.2] transition-colors hover:bg-accent"
                  >
                    <StatusIcon
                      status={t.status as TaskStatus}
                      className="size-3.5 shrink-0"
                    />
                    <span className="min-w-0 flex-1 truncate text-foreground">
                      {t.title || "Untitled task"}
                    </span>
                  </Link>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleUnlink(t.linkId, t.id)}
                    title="Unlink"
                    className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover/row:opacity-100 disabled:opacity-60"
                  >
                    <X className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
