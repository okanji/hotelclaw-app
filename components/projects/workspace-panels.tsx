"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  CircleDot,
  FileText,
  FolderInput,
  Plus,
  Search,
  Sparkles,
  Tag,
  UserPlus,
  X,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusIcon } from "@/components/tasks/task-icons";
import type { EntityColor, TaskStatus } from "@/lib/db/types";
import { cn } from "@/lib/utils";
import { documentHref } from "@/lib/documents/document-href";
import { useOpenDocument } from "@/lib/documents/use-open-document";
import type { ActivityEvent } from "@/lib/query/activity-queries";

export type ScopedTask = { id: string; title: string; status: TaskStatus };
export type ScopedDoc = { id: string; title: string };
type Candidate = { id: string; title: string };

const PROJECT_DOT: Record<EntityColor, string> = {
  slate: "bg-slate-500",
  blue: "bg-blue-500",
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  rose: "bg-rose-500",
  violet: "bg-violet-500",
};

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

/* ── Projects: per-project progress for the projects a space spans ────────── */

export type ProjectProgress = {
  id: string;
  name: string;
  color: EntityColor;
  done: number;
  total: number;
};

/**
 * Lists the projects a space is part of, each with its own completion bar
 * (share of that project's tasks that are `done`) and a `done/total` tally.
 * Rows link through to the project. Surfaces "which initiatives run through
 * this space, and how far along each is" on the space Overview.
 */
export function ProjectProgressList({
  propertyId,
  projects,
}: {
  propertyId: string;
  projects: ProjectProgress[];
}) {
  if (projects.length === 0) {
    return (
      <p className="py-4 text-[0.8125rem] text-muted-foreground">
        No projects span this space yet — link one from a project&apos;s{" "}
        <span className="font-medium">Spaces</span> picker.
      </p>
    );
  }
  return (
    <ul
      role="list"
      className="flex flex-col divide-y divide-border/40 border-t border-border/40"
    >
      {projects.map((p) => {
        const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
        return (
          <li key={p.id} className="group/row">
            <Link
              href={`/p/${propertyId}/projects/${p.id}`}
              className="flex items-center gap-3 rounded-md px-1 py-3 transition-colors hover:bg-muted"
            >
              <span
                className={cn(
                  "size-2 shrink-0 rounded-full",
                  PROJECT_DOT[p.color],
                )}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1 truncate text-[0.875rem] tracking-tight text-foreground">
                {p.name || "Untitled project"}
              </span>
              <div className="flex w-32 shrink-0 items-center gap-2.5 sm:w-44">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                  {p.total > 0 ? (
                    <div
                      className="h-full rounded-full bg-emerald-500 transition-[width]"
                      style={{ width: `${pct}%` }}
                    />
                  ) : null}
                </div>
                <span className="w-9 shrink-0 text-right text-[0.75rem] font-medium tabular-nums text-foreground">
                  {pct}%
                </span>
              </div>
              <span className="hidden w-12 shrink-0 text-right text-[0.75rem] tabular-nums text-muted-foreground sm:inline">
                {p.done}/{p.total}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/* ── Activity: recent task events in this space / project ─────────────────── */

const STATUS_LABEL: Record<string, string> = {
  todo: "To do",
  in_progress: "In progress",
  blocked: "Blocked",
  done: "Done",
};

/** Map an event type to its glyph + a human sentence about the task. */
function describeEvent(e: ActivityEvent): {
  Icon: typeof Sparkles;
  text: React.ReactNode;
} {
  const title = (
    <span className="font-medium text-foreground">{e.title || "a task"}</span>
  );
  switch (e.eventType) {
    case "task.created":
      return { Icon: Plus, text: <>Created {title}</> };
    case "task.status_changed":
      return {
        Icon: CircleDot,
        text: (
          <>
            Moved {title} to{" "}
            <span className="text-foreground">
              {STATUS_LABEL[e.toValue ?? ""] ?? e.toValue}
            </span>
          </>
        ),
      };
    case "task.assigned":
      return { Icon: UserPlus, text: <>Reassigned {title}</> };
    case "task.label_added":
      return { Icon: Tag, text: <>Labelled {title}</> };
    case "task.added_to_space":
      return { Icon: FolderInput, text: <>Added {title} to this space</> };
    case "task.added_to_project":
      return { Icon: FolderInput, text: <>Added {title} to a project</> };
    default:
      return { Icon: Sparkles, text: <>Updated {title}</> };
  }
}

/** Compact relative time: just now, 5m, 3h, 2d, 4w, then an absolute date. */
function timeAgo(iso: string): string {
  const secs = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  const wks = Math.floor(days / 7);
  if (wks < 5) return `${wks}w`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/**
 * Recent activity for a space / project — newest first, each row a glyph + a
 * sentence + relative time. Source events carry no actor, so lines describe the
 * change, not who made it.
 */
export function ActivityFeed({
  events,
  pending,
}: {
  events: ActivityEvent[];
  pending?: boolean;
}) {
  if (pending && events.length === 0) {
    return (
      <p className="py-1 text-[0.8125rem] text-muted-foreground">Loading…</p>
    );
  }
  if (events.length === 0) {
    return (
      <p className="py-1 text-[0.8125rem] text-muted-foreground">
        No activity yet — it&apos;ll show here as tasks move.
      </p>
    );
  }
  return (
    <ul role="list" className="flex flex-col gap-3">
      {events.map((e) => {
        const { Icon, text } = describeEvent(e);
        return (
          <li key={e.id} className="flex items-start gap-2.5">
            <span className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Icon className="size-3" strokeWidth={1.75} />
            </span>
            <p className="min-w-0 flex-1 text-[0.8125rem] leading-5 tracking-tight text-muted-foreground">
              {text}
              <span className="text-muted-foreground/70"> · {timeAgo(e.at)}</span>
            </p>
          </li>
        );
      })}
    </ul>
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
