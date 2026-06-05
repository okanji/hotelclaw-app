"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { FileText, Plus, Search, X } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusIcon } from "@/components/tasks/task-icons";
import type { TaskStatus } from "@/lib/db/types";
import { documentHref } from "@/lib/documents/document-href";
import { useOpenDocument } from "@/lib/documents/use-open-document";

export type ScopedTask = { id: string; title: string; status: TaskStatus };
export type ScopedDoc = { id: string; title: string };
type Candidate = { id: string; title: string };

const STATUS_COLUMNS: { id: TaskStatus; label: string }[] = [
  { id: "todo", label: "To do" },
  { id: "in_progress", label: "In progress" },
  { id: "blocked", label: "Blocked" },
  { id: "done", label: "Done" },
];

/* ── Overview: progress over the scoped tasks ─────────────────────────────── */

export function ProgressOverview({ tasks }: { tasks: ScopedTask[] }) {
  const counts = useMemo(() => {
    const c: Record<TaskStatus, number> = {
      todo: 0,
      in_progress: 0,
      blocked: 0,
      done: 0,
    };
    for (const t of tasks) c[t.status] += 1;
    return c;
  }, [tasks]);
  const total = tasks.length;
  const pct = total ? Math.round((counts.done / total) * 100) : 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-[1.75rem] leading-none font-semibold tracking-tight text-foreground tabular-nums">
            {pct}%
          </span>
          <span className="text-[0.6875rem] font-medium tracking-wider text-muted-foreground uppercase">
            Complete
          </span>
        </div>
        <span className="text-[0.8125rem] tracking-tight text-muted-foreground tabular-nums">
          {counts.done} / {total} done
        </span>
      </div>
      <div className="flex h-2 overflow-hidden rounded-full bg-muted">
        {total > 0 ? (
          <div
            className="h-full bg-emerald-500 transition-[width]"
            style={{ width: `${pct}%` }}
          />
        ) : null}
      </div>
      <dl className="flex flex-wrap gap-x-5 gap-y-1">
        {STATUS_COLUMNS.map((s) => (
          <div key={s.id} className="flex items-center gap-1.5">
            <StatusIcon status={s.id} className="size-3.5" />
            <dt className="text-[0.75rem] tracking-tight text-muted-foreground">
              {s.label}
            </dt>
            <dd className="text-[0.75rem] font-medium tabular-nums text-foreground">
              {counts[s.id]}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/* ── Tasks: status board of the scoped tasks ──────────────────────────────── */

export function TasksPanel({
  propertyId,
  tasks,
  candidates,
  onAdd,
  onRemove,
}: {
  propertyId: string;
  tasks: ScopedTask[];
  candidates: Candidate[];
  onAdd: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const byStatus = useMemo(() => {
    const m: Record<TaskStatus, ScopedTask[]> = {
      todo: [],
      in_progress: [],
      blocked: [],
      done: [],
    };
    for (const t of tasks) m[t.status].push(t);
    return m;
  }, [tasks]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[0.8125rem] tracking-tight text-muted-foreground tabular-nums">
          {tasks.length} {tasks.length === 1 ? "task" : "tasks"}
        </span>
        <AddPicker label="Add tasks" candidates={candidates} onAdd={onAdd} />
      </div>
      {tasks.length === 0 ? (
        <p className="py-4 text-[0.8125rem] text-muted-foreground">
          No tasks yet — use <span className="font-medium">Add tasks</span> to
          pull work in.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-6 @2xl:grid-cols-2">
          {STATUS_COLUMNS.map((col) =>
            byStatus[col.id].length > 0 ? (
              <section key={col.id}>
                <div className="mb-2 flex items-center gap-2">
                  <StatusIcon status={col.id} className="size-3.5" />
                  <h3 className="text-[0.75rem] font-medium tracking-tight text-foreground">
                    {col.label}
                  </h3>
                  <span className="text-[0.6875rem] text-muted-foreground tabular-nums">
                    {byStatus[col.id].length}
                  </span>
                </div>
                <ul
                  role="list"
                  className="flex flex-col divide-y divide-border/40 border-t border-border/40"
                >
                  {byStatus[col.id].map((t) => (
                    <li key={t.id} className="group/row relative">
                      <Link
                        href={`/p/${propertyId}/tasks/${t.id}`}
                        className="flex items-center gap-2.5 rounded-md px-1 py-2 pr-8 transition-colors hover:bg-muted"
                      >
                        <span className="min-w-0 flex-1 truncate text-[0.8125rem] tracking-tight text-foreground">
                          {t.title || "Untitled task"}
                        </span>
                      </Link>
                      <Remove onClick={() => onRemove(t.id)} />
                    </li>
                  ))}
                </ul>
              </section>
            ) : null,
          )}
        </div>
      )}
    </div>
  );
}

/* ── Docs: scoped documents list ──────────────────────────────────────────── */

export function DocsPanel({
  propertyId,
  docs,
  candidates,
  onAdd,
  onRemove,
}: {
  propertyId: string;
  docs: ScopedDoc[];
  candidates: Candidate[];
  onAdd: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const openDocument = useOpenDocument(propertyId);
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[0.8125rem] tracking-tight text-muted-foreground tabular-nums">
          {docs.length} {docs.length === 1 ? "document" : "documents"}
        </span>
        <AddPicker label="Add docs" candidates={candidates} onAdd={onAdd} />
      </div>
      {docs.length === 0 ? (
        <p className="py-4 text-[0.8125rem] text-muted-foreground">
          No documents yet — use <span className="font-medium">Add docs</span> to
          link pages here.
        </p>
      ) : (
        <ul
          role="list"
          className="flex flex-col divide-y divide-border/40 border-t border-border/40"
        >
          {docs.map((d) => (
            <li key={d.id} className="group/row relative">
              <Link
                href={documentHref(propertyId, d.id)}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0)
                    return;
                  e.preventDefault();
                  openDocument(d.id);
                }}
                className="flex items-center gap-3 rounded-md px-1 py-2.5 pr-9 transition-colors hover:bg-muted"
              >
                <FileText
                  strokeWidth={1.5}
                  className="size-4 shrink-0 text-muted-foreground"
                />
                <span className="min-w-0 flex-1 truncate text-[0.875rem] tracking-tight text-foreground">
                  {d.title || "Untitled"}
                </span>
              </Link>
              <Remove onClick={() => onRemove(d.id)} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ── Shared bits ──────────────────────────────────────────────────────────── */

export function Remove({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label="Remove"
      title="Remove"
      onClick={onClick}
      className="absolute top-1/2 right-1.5 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity group-hover/row:opacity-100 hover:bg-background hover:text-destructive"
    >
      <X className="size-3.5" />
    </button>
  );
}

export function AddPicker({
  label,
  candidates,
  onAdd,
}: {
  label: string;
  candidates: Candidate[];
  onAdd: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const filtered = candidates
    .filter((c) =>
      q.trim() ? (c.title || "").toLowerCase().includes(q.trim().toLowerCase()) : true,
    )
    .slice(0, 8);
  return (
    <Popover>
      <PopoverTrigger render={<Button type="button" size="sm" variant="outline" />}>
        <Plus className="size-4" />
        {label}
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} className="w-64 p-2">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search…"
            className="h-8 pl-8 text-sm"
          />
        </div>
        <ul className="mt-1.5 max-h-56 overflow-y-auto">
          {filtered.length === 0 ? (
            <li className="px-2 py-3 text-center text-xs text-muted-foreground">
              Nothing to add
            </li>
          ) : (
            filtered.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => onAdd(c.id)}
                  className="w-full truncate rounded-md px-2 py-1.5 text-left text-sm tracking-tight transition-colors hover:bg-muted"
                >
                  {c.title || "Untitled"}
                </button>
              </li>
            ))
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
