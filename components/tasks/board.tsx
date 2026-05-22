"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useBroadcastEvent } from "@liveblocks/react";
import { ListChecks, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shell/page-header";
import { CreateTaskDialog } from "./create-task-dialog";
import { TasksBoardSkeleton } from "./board-skeleton";
import { PresenceBar } from "./presence-bar";
import { BoardToolbar, type BoardFilters, type ViewMode } from "./board-toolbar";
import { KanbanView } from "./kanban-view";
import { ListView } from "./list-view";
import { TimelineView } from "./timeline-view";
import { PRIORITY_META, type Task } from "./kanban";
import type { TaskStatus } from "@/lib/db/types";
import { tasksQueryOptions } from "@/lib/query/section-queries";
import { useAssigneesMap } from "@/lib/tasks/use-assignees";

const EMPTY_TASKS: Task[] = [];

const DEFAULT_FILTERS: BoardFilters = {
  search: "",
  priorities: [],
  sortBy: "manual",
  statusPreset: "all",
};

export function TasksBoard({
  propertyId,
  currentUserId,
}: {
  propertyId: string;
  currentUserId: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const qc = useQueryClient();
  const broadcast = useBroadcastEvent();
  const mineOnly = searchParams.get("view") === "mine";

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

  // Filters/view live in component state — they're UI-only and don't need
  // to round-trip through the URL (the existing `?view=mine` flag is still
  // honored separately for shareable "My tasks" links).
  const [filters, setFilters] = useState<BoardFilters>(DEFAULT_FILTERS);
  const [view, setView] = useState<ViewMode>("board");
  const [createOpen, setCreateOpen] = useState(false);
  const [createStatus, setCreateStatus] = useState<TaskStatus>("todo");

  // Resolve assignee names/avatars once for the whole board — shared cache.
  const assigneeIds = useMemo(
    () => allTasks.map((t) => t.assignee_id),
    [allTasks],
  );
  const assignees = useAssigneesMap(assigneeIds);

  // Tasks visible to this user before filters (the "Mine" cut).
  const scopedTasks = useMemo(
    () =>
      mineOnly
        ? allTasks.filter((t) => t.assignee_id === currentUserId)
        : allTasks,
    [allTasks, mineOnly, currentUserId],
  );

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
      if (
        filters.priorities.length > 0 &&
        !filters.priorities.includes(t.priority)
      ) {
        return false;
      }
      if (needle && !t.title.toLowerCase().includes(needle)) return false;
      return true;
    });

    // Sort within `out`, preserving manual order when requested. For the
    // kanban view, columns enforce status grouping later — sort here only
    // changes per-column / per-row ordering.
    out.sort((a, b) => {
      if (filters.sortBy === "priority") {
        const dp =
          PRIORITY_META[a.priority].order - PRIORITY_META[b.priority].order;
        if (dp !== 0) return dp;
        return a.position - b.position;
      }
      if (filters.sortBy === "due_at") {
        const av = a.due_at ? Date.parse(a.due_at) : Number.POSITIVE_INFINITY;
        const bv = b.due_at ? Date.parse(b.due_at) : Number.POSITIVE_INFINITY;
        if (av !== bv) return av - bv;
        return a.position - b.position;
      }
      return a.position - b.position;
    });
    return out;
  }, [scopedTasks, filters]);

  function toggleMine() {
    const next = new URLSearchParams(searchParams.toString());
    if (mineOnly) next.delete("view");
    else next.set("view", "mine");
    const qs = next.toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ""}`);
  }

  const openCreate = useCallback((status: TaskStatus) => {
    setCreateStatus(status);
    setCreateOpen(true);
  }, []);

  // Both "Active" and "Backlog" presets hide the Done column in views that
  // can collapse it. "All" leaves every column visible.
  const hideDone = filters.statusPreset !== "all";

  if (isPending) return <TasksBoardSkeleton />;

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <PageHeader
        title={mineOnly ? "My tasks" : "Tasks"}
        icon={<ListChecks />}
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
        filters={filters}
        onChange={setFilters}
        total={scopedTasks.length}
        visible={filteredTasks.length}
        mineOnly={mineOnly}
        onToggleMine={toggleMine}
        view={view}
        onChangeView={setView}
      />

      {view === "board" ? (
        <KanbanView
          propertyId={propertyId}
          tasks={filteredTasks}
          assignees={assignees}
          hideDone={hideDone}
          onOpenFullCreate={openCreate}
        />
      ) : view === "list" ? (
        <ListView
          propertyId={propertyId}
          tasks={filteredTasks}
          assignees={assignees}
          hideDone={hideDone}
          onChanged={notifyChanged}
          onOpenFullCreate={openCreate}
        />
      ) : (
        <TimelineView
          propertyId={propertyId}
          tasks={filteredTasks}
          assignees={assignees}
          hideDone={hideDone}
        />
      )}

      <CreateTaskDialog
        propertyId={propertyId}
        status={createStatus}
        onStatusChange={setCreateStatus}
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={notifyChanged}
      />
    </div>
  );
}
