"use client";

import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useBroadcastEvent } from "@liveblocks/react";
import { ListChecks, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shell/page-header";
import { TasksBoardSkeleton } from "./board-skeleton";
import { PresenceBar } from "./presence-bar";
import {
  BoardToolbar,
  DEFAULT_FILTERS,
  type BoardFilters,
  type BoardGroupBy,
  type ViewMode,
} from "./board-toolbar";
import { propertyTaskFieldValuesQueryOptions } from "@/lib/query/custom-field-queries";
import {
  ActiveFilterBar,
  buildFieldValueIndex,
  matchesFacets,
  type FacetKey,
} from "./board-filters";
import { KanbanView } from "./kanban-view";
import { KanbanGroupedView } from "./kanban-grouped-view";
import { ListView } from "./list-view";
import { TimelineView } from "./timeline-view";
import { WorkloadView } from "./workload-view";
import { PRIORITY_META, type Task } from "./kanban";
import type { TaskStatus } from "@/lib/db/types";
import { tasksQueryOptions } from "@/lib/query/section-queries";
import {
  projectsQueryOptions,
  spacesQueryOptions,
} from "@/lib/query/project-queries";
import { useAssigneesMap } from "@/lib/tasks/use-assignees";

const EMPTY_TASKS: Task[] = [];

export function TasksBoard({
  propertyId,
  currentUserId,
}: {
  propertyId: string;
  currentUserId: string;
}) {
  const searchParams = useSearchParams();
  const qc = useQueryClient();
  const broadcast = useBroadcastEvent();
  const mineOnly = searchParams.get("view") === "mine";
  const spaceFilter = searchParams.get("space");
  const projectFilter = searchParams.get("project");

  /**
   * Invalidate the local cache AND broadcast to teammates so other clients
   * in this room pick up changes immediately (list/timeline actions don't
   * go through the kanban's optimistic-move path, so they need this hook
   * explicitly).
   */
  const notifyChanged = useCallback(() => {
    broadcast({ type: "tasks-invalidate" });
    qc.invalidateQueries({ queryKey: ["tasks", propertyId] });
  }, [broadcast, qc, propertyId]);

  const { data, isPending } = useQuery(tasksQueryOptions(propertyId));
  const allTasks = data ?? EMPTY_TASKS;

  // Sub-issues live under their parent on the detail page — keep the board
  // to top-level work items only.
  const topLevelTasks = useMemo(
    () => allTasks.filter((t) => !t.parent_id),
    [allTasks],
  );
  // Sub-tasks grouped by parent — the list view renders them as expandable
  // indented rows under their parent.
  const childrenByParent = useMemo(() => {
    const map = new Map<string, typeof allTasks>();
    for (const t of allTasks) {
      if (!t.parent_id) continue;
      const list = map.get(t.parent_id) ?? [];
      list.push(t);
      map.set(t.parent_id, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.position - b.position);
    return map;
  }, [allTasks]);

  // Filters/view live in component state — they're UI-only and don't need
  // to round-trip through the URL (the existing `?view=mine` flag is still
  // honored separately for shareable "My tasks" links).
  const [filters, setFilters] = useState<BoardFilters>(DEFAULT_FILTERS);
  const [view, setView] = useState<ViewMode>("board");
  const [groupBy, setGroupBy] = useState<BoardGroupBy>("status");
  // Facet just added from the "+ Filter" menu — its chip mounts auto-opened
  // so the user can pick values. Cleared once it has a value or is dismissed.
  const [addedFacet, setAddedFacet] = useState<FacetKey | null>(null);
  // Reference "now" for the due-date facet buckets — captured once (day-grain
  // buckets don't need per-render freshness, and it keeps the memo pure).
  const [now] = useState(() => Date.now());

  // Resolve assignee names/avatars once for the whole board — shared cache.
  const assigneeIds = useMemo(
    () => topLevelTasks.map((t) => t.assignee_id),
    [topLevelTasks],
  );
  const assignees = useAssigneesMap(assigneeIds);

  // Tasks visible before the toolbar filters: the "Mine" cut + an optional
  // Space/Project scope (driven by `?space=`/`?project=` — set by the Tasks
  // sidebar's saved views).
  const scopedTasks = useMemo(() => {
    let out = topLevelTasks;
    if (mineOnly) out = out.filter((t) => t.assignee_id === currentUserId);
    if (spaceFilter) out = out.filter((t) => t.space_id === spaceFilter);
    if (projectFilter) out = out.filter((t) => t.project_id === projectFilter);
    return out;
  }, [topLevelTasks, mineOnly, currentUserId, spaceFilter, projectFilter]);

  // Custom-field values for the whole property, indexed for match time. The
  // query only runs while a field filter is active — boards without one pay
  // nothing.
  const hasFieldFilter = Object.values(filters.fieldValues).some(
    (v) => v.length > 0,
  );
  const { data: fieldValueRows = [] } = useQuery({
    ...propertyTaskFieldValuesQueryOptions(propertyId),
    enabled: hasFieldFilter,
  });
  const fieldIndex = useMemo(
    () => buildFieldValueIndex(fieldValueRows),
    [fieldValueRows],
  );

  // Resolve the active scope's name for the breadcrumb (cheap, cached).
  const { data: spaces = [] } = useQuery({
    ...spacesQueryOptions(propertyId),
    enabled: !!spaceFilter,
  });
  const { data: projects = [] } = useQuery({
    ...projectsQueryOptions(propertyId),
    enabled: !!projectFilter,
  });
  const scopeName = spaceFilter
    ? spaces.find((s) => s.id === spaceFilter)?.name
    : projectFilter
      ? projects.find((p) => p.id === projectFilter)?.name
      : null;

  const filteredTasks = useMemo(() => {
    const needle = filters.search.trim().toLowerCase();
    const out = scopedTasks.filter((t) => {
      // Status preset — narrows the working set to the pill-tab selection.
      // "All" keeps everything; "Active" hides done; "Backlog" shows only
      // todo (the kanban view still renders empty in_progress/blocked
      // columns so cards can be dropped into them).
      if (filters.statusPreset === "active" && t.status === "done") {
        return false;
      }
      if (filters.statusPreset === "backlog" && t.status !== "todo") {
        return false;
      }
      // Additive facet chips (assignee / priority / team / due / …).
      if (!matchesFacets(t, filters, now, fieldIndex)) return false;
      if (needle && !t.title.toLowerCase().includes(needle)) return false;
      return true;
    });

    // Sort within `out`. The sort STACK wins when present (multi-key,
    // ClickUp-style: first key orders, later keys break ties); otherwise the
    // single `sortBy`; manual position is always the final tie-break. For the
    // kanban view, columns enforce status grouping later — sort here only
    // changes per-column / per-row ordering.
    const stack: ("priority" | "due_at")[] =
      filters.sortKeys.length > 0
        ? filters.sortKeys
        : filters.sortBy !== "manual"
          ? [filters.sortBy]
          : [];
    const compareBy = (key: "priority" | "due_at", a: Task, b: Task): number => {
      if (key === "priority") {
        return PRIORITY_META[a.priority].order - PRIORITY_META[b.priority].order;
      }
      const av = a.due_at ? Date.parse(a.due_at) : Number.POSITIVE_INFINITY;
      const bv = b.due_at ? Date.parse(b.due_at) : Number.POSITIVE_INFINITY;
      return av - bv;
    };
    out.sort((a, b) => {
      for (const key of stack) {
        const d = compareBy(key, a, b);
        if (d !== 0) return d;
      }
      return a.position - b.position;
    });
    return out;
  }, [scopedTasks, filters, now, fieldIndex]);

  // Open the full-page create experience, carrying the column the affordance
  // was triggered from plus any active board scope so the new task inherits it.
  const openCreate = useCallback(
    (status: TaskStatus) => {
      const params = new URLSearchParams();
      if (status) params.set("status", status);
      if (spaceFilter) params.set("space", spaceFilter);
      if (projectFilter) params.set("project", projectFilter);
      const qs = params.toString();
      window.history.pushState(
        null,
        "",
        `/p/${propertyId}/tasks/new${qs ? `?${qs}` : ""}`,
      );
      // `usePathname` doesn't update on pushState — nudge the surface to
      // re-derive off the new URL (same channel as task open/close).
      window.dispatchEvent(new Event("hotelclaw:pathname"));
    },
    [propertyId, spaceFilter, projectFilter],
  );

  // Both "Active" and "Backlog" presets hide the Done column in views that
  // can collapse it. "All" leaves every column visible.
  const hideDone = filters.statusPreset !== "all";

  if (isPending) return <TasksBoardSkeleton />;

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <PageHeader
        breadcrumbs={
          mineOnly
            ? [
                {
                  label: "Tasks",
                  href: `/p/${propertyId}/tasks`,
                  icon: <ListChecks />,
                },
                { label: "My tasks" },
              ]
            : scopeName
              ? [
                  {
                    label: "Tasks",
                    href: `/p/${propertyId}/tasks`,
                    icon: <ListChecks />,
                  },
                  { label: scopeName },
                ]
              : [{ label: "Tasks", icon: <ListChecks /> }]
        }
        actions={
          <>
            <PresenceBar />
            <Button size="sm" onClick={() => openCreate("todo")}>
              <Plus />
              New task
            </Button>
          </>
        }
      />
      <BoardToolbar
        propertyId={propertyId}
        filters={filters}
        onChange={setFilters}
        total={scopedTasks.length}
        visible={filteredTasks.length}
        onPickFacet={setAddedFacet}
        view={view}
        onChangeView={setView}
        groupBy={groupBy}
        onChangeGroupBy={setGroupBy}
      />
      <ActiveFilterBar
        propertyId={propertyId}
        filters={filters}
        onChange={setFilters}
        currentUserId={currentUserId}
        addedFacet={addedFacet}
        onResolveAdded={() => setAddedFacet(null)}
      />

      {view === "board" ? (
        groupBy === "status" ? (
          <KanbanView
            propertyId={propertyId}
            tasks={filteredTasks}
            assignees={assignees}
            hideDone={hideDone}
            onOpenFullCreate={openCreate}
            scopeSpaceId={spaceFilter}
          />
        ) : (
          <KanbanGroupedView
            propertyId={propertyId}
            tasks={filteredTasks}
            assignees={assignees}
            groupBy={groupBy}
          />
        )
      ) : view === "list" ? (
        <ListView
          propertyId={propertyId}
          tasks={filteredTasks}
          childrenByParent={childrenByParent}
          assignees={assignees}
          hideDone={hideDone}
          onChanged={notifyChanged}
          onOpenFullCreate={openCreate}
        />
      ) : view === "timeline" ? (
        <TimelineView
          propertyId={propertyId}
          tasks={filteredTasks}
          assignees={assignees}
          hideDone={hideDone}
        />
      ) : (
        <WorkloadView
          propertyId={propertyId}
          tasks={filteredTasks}
          assignees={assignees}
          hideDone={hideDone}
        />
      )}
    </div>
  );
}
