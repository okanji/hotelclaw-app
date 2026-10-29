"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { RoomProvider } from "@liveblocks/react";
import { ListChecks, Plus, Search, SearchX } from "lucide-react";
import { KanbanView } from "@/components/tasks/kanban-view";
import { ListView } from "@/components/tasks/list-view";
import type { Task } from "@/components/tasks/kanban";
import { AddPicker } from "@/components/projects/workspace-panels";
import { useStatusCatalog } from "@/lib/query/status-queries";
import { columnsFor } from "@/lib/tasks/statuses";
import { taskAssigneeIds } from "@/lib/tasks/assignees";
import { AssigneesMapProvider, useAssigneesMap } from "@/lib/tasks/use-assignees";
import type { CustomFieldOption } from "@/lib/db/types";
import { Gi } from "./icon";
import { G8Empty } from "./members-shared";

/**
 * The project's Board and List tabs — gr8r's `taskViewBody` (`viewToolbar` +
 * `boardHtml` / `listHtml`) over OUR board components: the real
 * `KanbanView` (drag between columns, column menus, inline add) and the
 * real `ListView` (configurable columns, inline edits, sub-issue rows),
 * scoped to the project's tasks. Both share the tasks board's Liveblocks
 * room, so a move here reaches teammates on the board too.
 */

const NO_LABELS: Record<string, CustomFieldOption[]> = {};
const INITIAL_PRESENCE = {
  cursor: null,
  selectedTaskId: null,
  draggingTaskId: null,
  editingEventId: null,
  focusedDay: null,
  selectedCell: null,
  selectionRange: null,
  activeSheetId: null,
};

export function ProjectTaskViews({
  propertyId,
  projectId,
  mode,
  tasks,
  candidates,
  onAdd,
}: {
  propertyId: string;
  projectId: string;
  mode: "board" | "list";
  /** Every task of the project (sub-issues included) — full board rows. */
  tasks: Task[];
  /** Property tasks outside the project, for "Add existing". */
  candidates: { id: string; title: string }[];
  onAdd: (id: string) => void;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const catalog = useStatusCatalog(propertyId);
  const [q, setQ] = useState("");
  const [hideDone, setHideDone] = useState(false);

  const topLevel = useMemo(() => tasks.filter((t) => !t.parent_id), [tasks]);
  const childrenByParent = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const t of tasks) {
      if (!t.parent_id) continue;
      const list = map.get(t.parent_id) ?? [];
      list.push(t);
      map.set(t.parent_id, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.position - b.position);
    return map;
  }, [tasks]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return topLevel;
    return topLevel.filter(
      (t) =>
        (t.title ?? "").toLowerCase().includes(needle) ||
        (t.key ?? "").toLowerCase().includes(needle),
    );
  }, [topLevel, q]);

  // One list holds all of the project's work → that list's own pipeline is
  // the board; work spread over lists → the four category columns.
  const onlyList = useMemo(() => {
    const ids = new Set(topLevel.map((t) => t.list_id).filter(Boolean));
    return ids.size === 1 ? ([...ids][0] as string) : null;
  }, [topLevel]);
  const board = useMemo(() => columnsFor(catalog, onlyList), [catalog, onlyList]);

  const assignees = useAssigneesMap(
    useMemo(() => topLevel.flatMap((t) => taskAssigneeIds(t)), [topLevel]),
  );

  const openCreate = useCallback(
    (status: string) => {
      const params = new URLSearchParams({ project: projectId });
      if (status) params.set("status", status);
      if (onlyList) params.set("list", onlyList);
      router.push(`/p/${propertyId}/tasks/new?${params.toString()}`);
    },
    [router, propertyId, projectId, onlyList],
  );
  const onChanged = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ["tasks", propertyId] });
    void qc.invalidateQueries({ queryKey: ["project-detail", projectId] });
  }, [qc, propertyId, projectId]);

  const toolbar = (
    <div className="toolbar">
      <div className="inwrap">
        <Gi icon={Search} size={13} />
        <input
          className="input search-sm"
          placeholder="Search tasks"
          aria-label="Search tasks"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <label className="row" style={{ gap: 6, fontSize: 12.5, marginLeft: 8 }}>
        <input
          type="checkbox"
          className="toggle"
          checked={hideDone}
          onChange={(e) => setHideDone(e.target.checked)}
        />
        <span className="muted">Hide done</span>
      </label>
      <span className="faint num" style={{ fontSize: 12, marginLeft: 8 }}>
        {visible.length} {visible.length === 1 ? "task" : "tasks"}
      </span>
      <span className="sp" />
      <AddPicker label="Add existing" candidates={candidates} onAdd={onAdd} />
      <button
        type="button"
        className="btn btn-primary btn-sm"
        onClick={() => openCreate(board.columns[0]?.id ?? "todo")}
      >
        <Gi icon={Plus} size={13} />
        New task
      </button>
    </div>
  );

  let body: React.ReactNode;
  if (topLevel.length === 0) {
    body = (
      <G8Empty icon={ListChecks} title="No tasks here" text="Add a task to get things moving.">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() => openCreate(board.columns[0]?.id ?? "todo")}
        >
          <Gi icon={Plus} size={14} />
          Add task
        </button>
      </G8Empty>
    );
  } else if (visible.length === 0) {
    body = (
      <G8Empty icon={SearchX} title="No results found" text="No tasks match this search.">
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setQ("")}>
          Clear search
        </button>
      </G8Empty>
    );
  } else if (mode === "board") {
    body = (
      <KanbanView
        propertyId={propertyId}
        tasks={visible}
        board={board}
        assignees={assignees}
        cardLabels={NO_LABELS}
        hideDone={hideDone}
        onOpenFullCreate={openCreate}
        scopeListId={onlyList}
        scopeProjectId={projectId}
      />
    );
  } else {
    body = (
      <div className="list-wrap" style={{ flex: 1, minHeight: 0 }}>
        <ListView
          propertyId={propertyId}
          tasks={visible}
          childrenByParent={childrenByParent}
          assignees={assignees}
          hideDone={hideDone}
          onChanged={onChanged}
          onOpenFullCreate={openCreate}
        />
      </div>
    );
  }

  return (
    <RoomProvider id={`property:${propertyId}:tasks`} initialPresence={INITIAL_PRESENCE}>
      <AssigneesMapProvider value={assignees}>
        <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
          {toolbar}
          <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>{body}</div>
        </div>
      </AssigneesMapProvider>
    </RoomProvider>
  );
}
