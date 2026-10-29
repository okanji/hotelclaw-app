"use client";

import { useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import {
  FileText,
  Folder,
  ListChecks,
  Pin,
  PinOff,
  Plus,
  Search,
  X,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import type { EntityColor, TaskStatus } from "@/lib/db/types";
import { MAX_PINNED_RESOURCES } from "@/components/documents/doc-pin-card";
import { documentHref } from "@/lib/documents/document-href";
import { useOpenDocument } from "@/lib/documents/use-open-document";
import { useStatusCatalog } from "@/lib/query/status-queries";
import { Gi } from "@/components/gr8r/icon";
import { G8_COLOR, ProgBar, StIcon } from "@/components/gr8r/home-glyphs";
import { G8StatusIcon } from "@/components/gr8r/my-tasks-glyphs";
import { G8Empty } from "@/components/gr8r/members-shared";

/**
 * Scoped workspace panels (team page tabs + the initiative page's pickers),
 * drawn in gr8r's idiom: `.panel` / `.panel-h` / `.mini` rows, `.stackbar`,
 * `.seg` list filter, `.btn` actions. Exports + props are unchanged.
 */

type CSSVars = CSSProperties & Record<`--${string}`, string | number>;

export type ScopedTask = {
  id: string;
  title: string;
  status: TaskStatus;
  /** 0114 — present where the caller selects them; drive the list chips and
   *  the per-list pipeline grouping. */
  list_id?: string | null;
  status_id?: string | null;
};
export type ScopedDoc = { id: string; title: string };
type Candidate = { id: string; title: string };

const STATUS_COLUMNS: { id: TaskStatus; label: string }[] = [
  { id: "todo", label: "To do" },
  { id: "in_progress", label: "In progress" },
  { id: "blocked", label: "Blocked" },
  { id: "done", label: "Done" },
];

/** gr8r status tokens for the progress stackbar. */
const STATUS_SEG: Record<TaskStatus, string | null> = {
  done: "var(--g8-st-done)",
  in_progress: "var(--g8-st-progress)",
  blocked: "var(--g8-red)",
  todo: null,
};

/* ── Overview: progress over the scoped tasks ─────────────────────────────── */

function taskStatusCounts(tasks: ScopedTask[]) {
  const c: Record<TaskStatus, number> = {
    todo: 0,
    in_progress: 0,
    blocked: 0,
    done: 0,
  };
  for (const t of tasks) c[t.status] += 1;
  return c;
}

/** gr8r progress panel: a `.stackbar` over the scoped tasks + status tallies. */
export function ProgressOverview({ tasks }: { tasks: ScopedTask[] }) {
  const counts = useMemo(() => taskStatusCounts(tasks), [tasks]);
  const total = tasks.length;
  const pct = total ? Math.round((counts.done / total) * 100) : 0;
  const segment = (n: number) => (total ? (n / total) * 100 : 0);
  const barSegments: TaskStatus[] = ["done", "in_progress", "blocked"];

  return (
    <section className="panel">
      <div className="panel-h">
        <h2>Progress</h2>
        <span className="sp" />
        {total > 0 ? (
          <span className="faint" style={{ fontSize: 12, fontVariantNumeric: "tabular-nums" }}>
            {pct}%
          </span>
        ) : null}
      </div>
      <div className="panel-b stack" style={{ gap: 10 }}>
        {total === 0 ? (
          <span className="faint" style={{ fontSize: 12.5 }}>
            No tasks yet — progress will appear here as work is added.
          </span>
        ) : (
          <>
            <span className="muted" style={{ fontSize: 12.5 }}>
              <b style={{ fontWeight: 600 }}>{counts.done}</b> of{" "}
              <b style={{ fontWeight: 600 }}>{total}</b> completed
              {counts.in_progress > 0 ? <> · {counts.in_progress} in progress</> : null}
            </span>
            <div
              className="stackbar"
              role="img"
              aria-label={`${counts.done} done, ${counts.in_progress} in progress, ${counts.blocked} blocked, ${counts.todo} to do`}
            >
              {barSegments.map((status) =>
                counts[status] > 0 ? (
                  <i
                    key={status}
                    style={{
                      width: `${segment(counts[status])}%`,
                      background: STATUS_SEG[status] ?? undefined,
                    }}
                  />
                ) : null,
              )}
            </div>
            <dl className="row" style={{ gap: 14, flexWrap: "wrap", margin: 0, fontSize: 12 }}>
              {STATUS_COLUMNS.map((s) =>
                counts[s.id] > 0 ? (
                  <div key={s.id} className="row" style={{ gap: 5 }}>
                    <StIcon task={{ status: s.id }} size={12} />
                    <dt className="sr">{s.label}</dt>
                    <dd className="muted" style={{ margin: 0, fontVariantNumeric: "tabular-nums" }}>
                      <b style={{ fontWeight: 600 }}>{counts[s.id]}</b> {s.label}
                    </dd>
                  </div>
                ) : null,
              )}
            </dl>
          </>
        )}
      </div>
    </section>
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
      <div className="faint" style={{ padding: "8px 0", fontSize: 12.5 }}>
        No projects yet — link one from a project&apos;s <b>Teams</b> picker.
      </div>
    );
  }
  return (
    <div>
      {projects.map((p) => {
        const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
        return (
          <Link
            key={p.id}
            href={`/p/${propertyId}/projects/${p.id}`}
            className="mini"
            title={`${p.done}/${p.total} done`}
          >
            <span className="picon" style={{ "--g8-c": G8_COLOR[p.color] } as CSSVars}>
              <Gi icon={Folder} size={14} />
            </span>
            <span className="tt">{p.name || "Untitled project"}</span>
            <span className="row" style={{ width: 140, gap: 8 }}>
              <ProgBar value={pct} tone={pct === 100 ? "green" : ""} />
              <span className="faint" style={{ fontSize: 12, width: 30, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                {pct}%
              </span>
            </span>
          </Link>
        );
      })}
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
  lists,
}: {
  propertyId: string;
  tasks: ScopedTask[];
  candidates: Candidate[];
  onAdd: (id: string) => void;
  onRemove: (id: string) => void;
  /** The scope's lists (a team page) — renders a chip per list that narrows
   *  the panel to it and groups by that list's own pipeline. */
  lists?: { id: string; name: string }[];
}) {
  const catalog = useStatusCatalog(propertyId);
  const [listId, setListId] = useState<string | null>(null);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of tasks) if (t.list_id) m.set(t.list_id, (m.get(t.list_id) ?? 0) + 1);
    return m;
  }, [tasks]);
  // Chips only earn their row when there's more than one place work lives.
  const chipLists = (lists ?? []).filter(
    (l) => (counts.get(l.id) ?? 0) > 0 || (lists?.length ?? 0) > 1,
  );
  const showChips = chipLists.length > 1;
  const activeList = showChips ? listId : null;
  const visible = useMemo(
    () => (activeList ? tasks.filter((t) => t.list_id === activeList) : tasks),
    [tasks, activeList],
  );

  // One list → its own pipeline stages; otherwise the four categories.
  const sections = useMemo(() => {
    if (activeList) {
      const stages = catalog.statusesOfList(activeList);
      if (stages.length > 0) {
        return stages.map((st) => ({
          key: st.id,
          label: st.name,
          icon: (
            <G8StatusIcon
              category={st.category}
              blocked={st.is_blocked}
              color={st.color}
            />
          ),
          rows: visible.filter((t) => t.status_id === st.id),
        }));
      }
    }
    return STATUS_COLUMNS.map((col) => ({
      key: col.id,
      label: col.label,
      icon: <StIcon task={{ status: col.id }} />,
      rows: visible.filter((t) => t.status === col.id),
    }));
  }, [activeList, catalog, visible]);

  return (
    <div className="stack">
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        {showChips ? (
          <div className="seg" role="group" aria-label="Lists" style={{ flexWrap: "wrap" }}>
            <button
              type="button"
              className={activeList === null ? "on" : ""}
              aria-pressed={activeList === null}
              onClick={() => setListId(null)}
            >
              All
              <span className="faint" style={{ fontVariantNumeric: "tabular-nums" }}>{tasks.length}</span>
            </button>
            {chipLists.map((l) => (
              <button
                key={l.id}
                type="button"
                className={activeList === l.id ? "on" : ""}
                aria-pressed={activeList === l.id}
                onClick={() => setListId(activeList === l.id ? null : l.id)}
              >
                {l.name}
                <span className="faint" style={{ fontVariantNumeric: "tabular-nums" }}>
                  {counts.get(l.id) ?? 0}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <span className="faint" style={{ fontSize: 12.5, fontVariantNumeric: "tabular-nums" }}>
            {visible.length} {visible.length === 1 ? "task" : "tasks"}
          </span>
        )}
        <span className="sp" />
        {activeList ? (
          <Link href={`/p/${propertyId}/tasks?list=${activeList}`} className="btn btn-ghost btn-sm">
            Open board
          </Link>
        ) : null}
        <AddPicker label="Add tasks" candidates={candidates} onAdd={onAdd} />
      </div>
      {visible.length === 0 ? (
        <section className="panel">
          <G8Empty
            icon={ListChecks}
            title={activeList ? "No tasks in this list yet" : "No tasks yet"}
            text={activeList ? "Tasks filed to this list will show here." : "Use Add tasks to pull work in."}
            sm
          />
        </section>
      ) : (
        sections.map((col) =>
          col.rows.length > 0 ? (
            <section key={col.key} className="panel">
              <div className="panel-h">
                {col.icon}
                <h2>{col.label}</h2>
                <span className="faint">{col.rows.length}</span>
              </div>
              {col.rows.map((t) => (
                <div key={t.id} className="mini g8-wsrow">
                  <Link href={`/p/${propertyId}/tasks/${t.id}`} className="g8-wsrow-a">
                    <StIcon task={t} />
                    <span className="tt">{t.title || "Untitled task"}</span>
                  </Link>
                  <Remove onClick={() => onRemove(t.id)} />
                </div>
              ))}
            </section>
          ) : null,
        )
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
  pinnedIds,
  onPin,
  onUnpin,
  pinLimit = MAX_PINNED_RESOURCES,
}: {
  propertyId: string;
  docs: ScopedDoc[];
  candidates: Candidate[];
  onAdd: (id: string) => void;
  onRemove: (id: string) => void;
  pinnedIds?: Set<string>;
  onPin?: (id: string) => void;
  onUnpin?: (id: string) => void;
  pinLimit?: number;
}) {
  const openDocument = useOpenDocument(propertyId);
  const pinCount = pinnedIds?.size ?? 0;
  const canPin = pinCount < pinLimit;
  return (
    <section className="panel">
      <div className="panel-h">
        <h2>Documents</h2>
        <span className="faint">{docs.length}</span>
        {pinnedIds && pinCount > 0 ? (
          <span className="faint" style={{ fontSize: 12 }}>· {pinCount} pinned</span>
        ) : null}
        <span className="sp" />
        <AddPicker label="Add docs" candidates={candidates} onAdd={onAdd} />
      </div>
      {docs.length === 0 ? (
        <G8Empty
          icon={FileText}
          title="No documents yet"
          text="Use Add docs to link pages here."
          sm
        />
      ) : (
        docs.map((d) => {
          const isPinned = pinnedIds?.has(d.id) ?? false;
          return (
            <div key={d.id} className="mini g8-wsrow">
              <Link
                href={documentHref(propertyId, d.id)}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0)
                    return;
                  e.preventDefault();
                  openDocument(d.id);
                }}
                className="g8-wsrow-a"
              >
                <Gi icon={FileText} size={14} />
                <span className="tt">{d.title || "Untitled"}</span>
                {isPinned ? <Gi icon={Pin} size={12} className="faint" /> : null}
              </Link>
              <span className="g8-wsrow-acts">
                {onPin && onUnpin ? (
                  <button
                    type="button"
                    className="ibtn ibtn-sm"
                    aria-label={isPinned ? "Unpin from overview" : "Pin to overview"}
                    title={isPinned ? "Unpin from overview" : "Pin to overview"}
                    disabled={!isPinned && !canPin}
                    onClick={() => (isPinned ? onUnpin(d.id) : onPin(d.id))}
                  >
                    <Gi icon={isPinned ? PinOff : Pin} size={13} />
                  </button>
                ) : null}
                <Remove inline onClick={() => onRemove(d.id)} />
              </span>
            </div>
          );
        })
      )}
    </section>
  );
}

/* ── Shared bits ──────────────────────────────────────────────────────────── */

export function Remove({
  onClick,
  inline,
}: {
  onClick: () => void;
  /** When true, parent handles visibility/position (e.g. action row). */
  inline?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label="Remove from space"
      title="Remove from space"
      onClick={onClick}
      className={inline ? "ibtn ibtn-sm g8-wsrow-rm" : "ibtn ibtn-sm g8-wsrow-rm g8-wsrow-hover"}
    >
      <Gi icon={X} size={13} />
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
      <PopoverTrigger render={<button type="button" className="btn btn-secondary btn-sm" />}>
        <Gi icon={Plus} size={14} />
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
            <li className="px-2 py-3 text-center text-xs text-faint-foreground">
              Nothing to add
            </li>
          ) : (
            filtered.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => onAdd(c.id)}
                  className="w-full truncate rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent"
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
