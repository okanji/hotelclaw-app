"use client";

import { ChecklistsPanel } from "./checklists-panel";
import { taskAssigneeIds } from "@/lib/tasks/assignees";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useTransition,
  type DragEvent,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useThreads } from "@liveblocks/react/suspense";
import { Composer, Thread } from "@liveblocks/react-ui";
import "@liveblocks/react-ui/styles.css";
import {
  ChevronDown,
  ChevronUp,
  Circle,
  CircleCheck,
  ClockAlert,
  File as FileIcon,
  FileSpreadsheet,
  FileText,
  Folder,
  FolderArchive,
  Image as ImageIcon,
  Link as LinkIcon,
  ListChecks,
  Maximize2,
  Minimize2,
  PanelRight,
  Paperclip,
  Plus,
  SquareArrowOutUpRight,
  Star,
  Upload,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { deleteTask, escalateTask, updateTask } from "./actions";
import { PageHeader } from "@/components/shell/page-header";
import { PresenceBar } from "./presence-bar";
import { STATUS_IDS, taskKey } from "./kanban";
import {
  SubIssuesPanel,
  TaskDetailSidebar,
} from "./task-detail-sidebar";
import { TaskDetailInlineProperties } from "./task-detail-inline-properties";
import { TaskAiPanel } from "./task-ai-panel";
import { TaskTriageSuggestions } from "./task-triage-suggestions";
import { TaskHistory } from "@/components/activity/task-history";
import { useTaskDetailMutations } from "./task-detail-mutations";
import {
  propertyMembersQueryOptions,
  tasksQueryOptions,
} from "@/lib/query/section-queries";
import { resolveTaskSequence } from "@/lib/tasks/task-sequence";
import { useVisibleTaskOrder } from "@/lib/tasks/visible-task-order";
import { useOpenTask } from "@/lib/tasks/use-open-task";
import { useAssigneesMap } from "@/lib/tasks/use-assignees";
import { taskHref } from "@/lib/tasks/task-href";
import { WorkflowProvenanceBadge } from "@/components/workflows/provenance-badge";
import type { TaskPriority, TaskRecurrence, TaskStatus } from "@/lib/db/types";
import { useTaskStatusOptions } from "@/lib/query/status-queries";
import { describeStatus, type ColumnDef } from "@/lib/tasks/statuses";
import type { StatusRowFields } from "./task-property-menus";
import type { TaskDetailMeta } from "@/lib/tasks/task-detail-meta";
import { Gi } from "@/components/gr8r/icon";
import { Av } from "@/components/gr8r/home-glyphs";
import { cVar } from "@/components/gr8r/my-tasks-glyphs";
import { useTaskDrawerChrome } from "@/components/gr8r/task-drawer-context";

type Task = {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  /** Lists + pipelines (0114). Optional so embedded hosts (triage) still compile. */
  listId?: string | null;
  statusId?: string | null;
  statusRow?: StatusRowFields;
  priority: TaskPriority;
  assigneeId: string | null;
  /** Everyone on the task, primary first (0115); absent → [assigneeId]. */
  assigneeIds?: string[];
  dueAt: string | null;
  /** Repeat cadence (migration 0107). */
  recurrence?: TaskRecurrence | null;
  createdAt?: string;
  /** Who opened the task (migration 0001 `created_by`). */
  createdBy?: string | null;
  /** Creation provenance (migration 0050). */
  source?: string | null;
  sourceWorkflowId?: string | null;
  sourceWorkflowRunId?: string | null;
  /** Human key `<task_prefix>-<number>` (0108); falls back to the UUID glyph. */
  key?: string | null;
};

function formatRelative(iso: string) {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const diffMs = Date.now() - then;
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

export function TaskDetail({
  propertyId,
  task,
  variant = "page",
}: {
  propertyId: string;
  task: Task;
  /**
   * "page" is the full tasks-route view: breadcrumb header + the utility
   * rail as a permanent flex sibling. "embedded" is for hosts that already
   * provide their own chrome and width (the chat's artifact side panel):
   * no breadcrumbs, compact gutters, and the rail stays CLOSED by default —
   * at panel widths a 300px flex sibling would squeeze the task itself, so
   * it opens as a floating drawer OVER the content instead.
   */
  variant?: "page" | "embedded";
}) {
  const qc = useQueryClient();
  const router = useRouter();
  const { threads } = useThreads();
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  // The column id the pickers write: the status row's uuid when the row
  // carries one, else the legacy literal (the DB resolves either).
  const [status, setStatus] = useState<string>(task.statusId ?? task.status);
  const statusOptions = useTaskStatusOptions(propertyId, task.listId);
  const [priority, setPriority] = useState<TaskPriority>(task.priority);
  const [assigneeIds, setAssigneeIds] = useState<string[]>(() =>
    taskAssigneeIds({ assignee_ids: task.assigneeIds, assignee_id: task.assigneeId }),
  );
  const assigneeId = assigneeIds[0] ?? null;
  const [dueAt, setDueAt] = useState<string | null>(task.dueAt);
  const [recurrence, setRecurrence] = useState<TaskRecurrence | null>(
    task.recurrence ?? null,
  );
  const [addingSubIssue, setAddingSubIssue] = useState(false);
  const embedded = variant === "embedded";
  // The utility rail as a dismissible overlay drawer — always in embedded
  // hosts, and on the full page below the width where the rail docks.
  const [railOpen, setRailOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const savedTitle = useRef(task.title);
  const savedDescription = useRef(task.description ?? "");

  // The artifact panel closes ITSELF on Escape (window-level listener in
  // artifact-side-panel.tsx). While the drawer is open, consume Escape in
  // the capture phase so it closes the drawer first, not the whole panel.
  useEffect(() => {
    if (!railOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        setRailOpen(false);
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [railOpen]);

  const assignees = useAssigneesMap([...assigneeIds, task.createdBy]);
  const assignee = assigneeId ? assignees[assigneeId] : undefined;
  const creator = task.createdBy ? assignees[task.createdBy] : undefined;

  const { data: members = [] } = useQuery(
    propertyMembersQueryOptions(propertyId),
  );

  const mutations = useTaskDetailMutations(propertyId, task.id);

  // Previous / next (Linear's ↑ ↓ / k j): the order the board / list last
  // showed (filters + sort), else plain board order. Full page only —
  // embedded hosts (triage, chat panel) own their own list navigation.
  const { data: allTasks } = useQuery({
    ...tasksQueryOptions(propertyId),
    enabled: !embedded,
  });
  const visibleOrder = useVisibleTaskOrder(propertyId);
  const sequence = resolveTaskSequence(
    allTasks,
    task.id,
    STATUS_IDS,
    visibleOrder,
  );
  const openTask = useOpenTask(propertyId);
  const { prevId, nextId } = sequence;
  useEffect(() => {
    if (embedded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key !== "j" && e.key !== "k") return;
      const el = document.activeElement as HTMLElement | null;
      if (
        el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.tagName === "SELECT" ||
          el.isContentEditable)
      )
        return;
      const target = e.key === "j" ? nextId : prevId;
      if (!target) return;
      e.preventDefault();
      openTask(target);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [embedded, nextId, prevId, openTask]);

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["tasks", propertyId] });
    qc.invalidateQueries({ queryKey: ["task-meta", propertyId, task.id] });
  }, [qc, propertyId, task.id]);

  function persist(
    patch: Parameters<typeof updateTask>[0],
    onOk?: () => void,
  ) {
    startTransition(async () => {
      const result = await updateTask(patch);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      invalidate();
      onOk?.();
    });
  }

  function saveTitle() {
    const trimmed = title.trim();
    if (!trimmed || trimmed === savedTitle.current) return;
    persist({ taskId: task.id, title: trimmed }, () => {
      savedTitle.current = trimmed;
    });
  }

  function saveDescription() {
    const next = description.trim();
    if (next === savedDescription.current) return;
    persist(
      { taskId: task.id, description: next || null },
      () => {
        savedDescription.current = next;
      },
    );
  }

  function saveStatus(next: string) {
    setStatus(next);
    persist({ taskId: task.id, status: next });
  }

  function savePriority(next: TaskPriority) {
    setPriority(next);
    persist({ taskId: task.id, priority: next });
  }

  function saveAssignee(next: string | null) {
    saveAssignees(next ? [next] : []);
  }

  function saveAssignees(next: string[]) {
    setAssigneeIds(next);
    persist({ taskId: task.id, assigneeIds: next });
  }

  function saveDueAt(next: string | null) {
    setDueAt(next);
    persist({ taskId: task.id, dueAt: next });
  }

  function saveRecurrence(next: TaskRecurrence | null) {
    setRecurrence(next);
    persist({ taskId: task.id, recurrence: next });
  }

  function copyTaskLink() {
    const url =
      typeof window !== "undefined"
        ? window.location.href
        : taskHref(propertyId, task.id);
    void navigator.clipboard.writeText(url);
    toast.success("Link copied");
  }

  function copyTaskId() {
    void navigator.clipboard.writeText(taskKey(task));
    toast.success("ID copied");
  }

  function copyTitle() {
    void navigator.clipboard.writeText(title.trim() || task.title);
    toast.success("Title copied");
  }

  function automateFromTask() {
    const labelHints = (task as unknown as { labels?: string[] }).labels ?? [];
    const goal =
      labelHints.length > 0
        ? `When a task labeled ${labelHints.join(" or ")} is created, …`
        : `When a task like "${task.title}" is created, …`;
    const url = `/p/${propertyId}/workflows/new?prefill=${encodeURIComponent(
      btoa(
        JSON.stringify({
          goal,
          source: "task-detail",
          task_id: task.id,
          labels: labelHints,
        }),
      ),
    )}`;
    router.push(url);
  }

  function escalate() {
    startTransition(async () => {
      const result = await escalateTask(task.id);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(`Escalated to ${result.targetName}`);
      invalidate();
    });
  }

  function removeTask() {
    if (!window.confirm("Delete this task? This cannot be undone.")) return;
    startTransition(async () => {
      const result = await deleteTask(task.id);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Task deleted");
      invalidate();
      window.history.pushState(null, "", `/p/${propertyId}/tasks`);
      // `usePathname` does not update on `pushState` — tell the surface to
      // re-derive off the new URL so it drops back to the board.
      window.dispatchEvent(new Event("hotelclaw:pathname"));
    });
  }

  // A host drawer (components/gr8r/task-drawer.tsx) hands down its Full
  // page / Open as page / Close buttons for the `.drawer-h` row.
  const chrome = useTaskDrawerChrome();
  const [tab, setTab] = useState<"comments" | "activity">("comments");

  // gr8r's title + description textareas grow with their text.
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const descRef = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    autosize(titleRef.current);
  }, [title]);
  useLayoutEffect(() => {
    autosize(descRef.current);
  }, [description]);

  // Mark complete / Reopen — the list's own done (else closed) status, or
  // its open status back; legacy literals when the pipeline isn't loaded
  // (the DB resolves them to the task's list either way).
  const statusView = describeStatus(statusOptions, status, task.statusRow);
  const isComplete =
    statusView.category === "done" || statusView.category === "closed";
  function toggleComplete() {
    saveStatus(
      isComplete ? reopenTarget(statusOptions) : completeTarget(statusOptions),
    );
  }
  const overdueDays = !isComplete && dueAt ? daysOverdue(dueAt) : 0;

  async function uploadFiles(files: FileList | File[]) {
    const list = Array.from(files);
    if (list.length === 0) return;
    let ok = 0;
    for (const file of list) {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch(
        `/api/properties/${propertyId}/tasks/${task.id}/attachments`,
        { method: "POST", body },
      );
      if (res.ok) ok += 1;
      else {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(data.error ?? `Couldn't upload ${file.name}`);
      }
    }
    if (ok) toast.success(ok === 1 ? "File attached" : `${ok} files attached`);
    invalidate();
  }

  const sidebarProps = {
    propertyId,
    taskId: task.id,
    status,
    statusOptions,
    statusRow: task.statusRow,
    priority,
    assigneeId,
    assignee,
    assigneeIds,
    assigneeInfos: assignees,
    onAssigneesChange: saveAssignees,
    dueAt,
    members,
    meta: mutations.meta,
    openers: mutations.openers,
    removers: mutations.removers,
    onStatusChange: saveStatus,
    onPriorityChange: savePriority,
    onAssigneeChange: saveAssignee,
    onDueAtChange: saveDueAt,
    recurrence,
    onRecurrenceChange: saveRecurrence,
    onCopyTitle: copyTitle,
    onCopyId: copyTaskId,
    onCopyLink: copyTaskLink,
    onDelete: removeTask,
    onEscalate: escalate,
    onAddSubIssue: () => setAddingSubIssue(true),
    onAutomate: automateFromTask,
  };

  const favorited = mutations.meta?.favorited ?? false;
  const projectName = mutations.meta?.projectName ?? null;

  return (
    // `@container/task`: the rail docks by the width this view actually
    // gets (the shell sidebar eats a variable share), not the viewport.
    <div className="@container/task flex h-full min-h-0 flex-col">
      {embedded ? null : (
        <PageHeader
          breadcrumbs={[
            {
              label: "Tasks",
              href: `/p/${propertyId}/tasks`,
              icon: <ListChecks />,
            },
            { label: taskKey(task) },
          ]}
          actions={
            <>
              {sequence.index >= 0 && sequence.total > 1 ? (
                <span className="faint num g8-task-seq">
                  {sequence.index + 1} / {sequence.total}
                </span>
              ) : null}
              <button
                type="button"
                className="ibtn ibtn-sm"
                aria-label="Previous task (k)"
                data-tip="Previous  K"
                disabled={!prevId}
                onClick={() => prevId && openTask(prevId)}
              >
                <Gi icon={ChevronUp} size={15} />
              </button>
              <button
                type="button"
                className="ibtn ibtn-sm"
                aria-label="Next task (j)"
                data-tip="Next  J"
                disabled={!nextId}
                onClick={() => nextId && openTask(nextId)}
              >
                <Gi icon={ChevronDown} size={15} />
              </button>
            </>
          }
        />
      )}
      <div className="relative flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          {/* gr8r's `.drawer-h`: where the task lives, then its quick actions. */}
          <div className="drawer-h">
            {projectName ? (
              <>
                <span className="pillbtn g8-task-crumb">
                  <Gi icon={Folder} size={13} />
                  <span className="trunc">{projectName}</span>
                </span>
                <span className="faint">/</span>
              </>
            ) : null}
            <span className="mono faint g8-task-key">{taskKey(task)}</span>
            <span className="sp" />
            <button
              type="button"
              className={cn(
                "btn btn-sm",
                isComplete ? "btn-secondary g8-task-done" : "btn-ghost",
              )}
              onClick={toggleComplete}
              disabled={pending}
              aria-pressed={isComplete}
            >
              <Gi icon={isComplete ? CircleCheck : Circle} size={14} />
              <span className="hide-m">
                {isComplete ? "Completed" : "Mark complete"}
              </span>
            </button>
            <button
              type="button"
              className={cn("ibtn ibtn-sm", favorited && "g8-on-star")}
              onClick={mutations.removers.toggleFavorite}
              aria-pressed={favorited}
              aria-label="Favorite"
              data-tip={favorited ? "Unfavorite" : "Favorite"}
            >
              <Gi icon={Star} size={15} />
            </button>
            <button
              type="button"
              className="ibtn ibtn-sm"
              onClick={copyTaskLink}
              aria-label="Copy link"
              data-tip="Copy link"
            >
              <Gi icon={LinkIcon} size={15} />
            </button>
            <span className={cn(!embedded && "@4xl/task:hidden")}>
              <button
                type="button"
                className="ibtn ibtn-sm"
                onClick={() => setRailOpen(true)}
                aria-label="Task details & actions"
                data-tip="Details & actions"
              >
                <Gi icon={PanelRight} size={15} />
              </button>
            </span>
            {chrome ? (
              <>
                <button
                  type="button"
                  className="ibtn ibtn-sm hide-m"
                  onClick={chrome.onToggleFull}
                  aria-label="Toggle full page"
                  data-tip={chrome.full ? "Side panel" : "Full page"}
                >
                  <Gi icon={chrome.full ? Minimize2 : Maximize2} size={15} />
                </button>
                <Link
                  href={chrome.expandHref}
                  className="ibtn ibtn-sm"
                  aria-label="Open as page"
                  data-tip="Open as page"
                >
                  <Gi icon={SquareArrowOutUpRight} size={15} />
                </Link>
                <button
                  type="button"
                  className="ibtn ibtn-sm"
                  onClick={chrome.onClose}
                  aria-label="Close"
                  data-tip="Close  Esc"
                >
                  <Gi icon={X} size={16} />
                </button>
              </>
            ) : null}
          </div>

          <div
            className={cn(
              "drawer-b",
              !embedded && "g8-task-page",
              chrome?.full && "g8-task-page",
            )}
          >
            <div className="g8-task-col">
              {isComplete ? (
                <div className="alert ok g8-task-alert">
                  <Gi icon={CircleCheck} size={15} />
                  <span>
                    Completed.{" "}
                    <button type="button" className="link" onClick={toggleComplete}>
                      Reopen task
                    </button>
                  </span>
                </div>
              ) : overdueDays > 0 ? (
                <div className="alert danger g8-task-alert">
                  <Gi icon={ClockAlert} size={15} />
                  <span>
                    Overdue by {overdueDays} day{overdueDays > 1 ? "s" : ""}.
                  </span>
                </div>
              ) : null}

              <textarea
                ref={titleRef}
                className="ttl-edit"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={saveTitle}
                onKeyDown={(e) => {
                  // gr8r: Enter commits the title (blur saves it).
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    e.currentTarget.blur();
                  } else if (e.key === "Escape") {
                    setTitle(savedTitle.current);
                    e.currentTarget.blur();
                  }
                }}
                rows={1}
                aria-label="Task title"
                disabled={pending}
              />

              {/* The `.kv` grid is the narrow-width home of properties. On the
                  full page, once the rail docks (@4xl), the rail is the single
                  home — properties live in one place. */}
              <div className={cn("g8-task-props", !embedded && "@4xl/task:hidden")}>
                <TaskDetailInlineProperties
                  propertyId={propertyId}
                  taskId={task.id}
                  status={status}
                  statusOptions={statusOptions}
                  statusRow={task.statusRow}
                  priority={priority}
                  assigneeId={assigneeId}
                  assignee={assignee}
                  assigneeIds={assigneeIds}
                  assigneeInfos={assignees}
                  onAssigneesChange={saveAssignees}
                  dueAt={dueAt}
                  members={members}
                  meta={mutations.meta}
                  openers={mutations.openers}
                  removers={mutations.removers}
                  onStatusChange={saveStatus}
                  onPriorityChange={savePriority}
                  onAssigneeChange={saveAssignee}
                  onDueAtChange={saveDueAt}
                  recurrence={recurrence}
                  onRecurrenceChange={saveRecurrence}
                />
              </div>

              <div className="g8-task-triage">
                <TaskTriageSuggestions propertyId={propertyId} taskId={task.id} />
              </div>

              <div className="dsec">
                <div className="dsec-h">
                  <h3 id={`d-desc-${task.id}`}>Description</h3>
                </div>
                <div className="rte">
                  <textarea
                    ref={descRef}
                    className="rte-body g8-rte-text"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    onBlur={saveDescription}
                    placeholder="Add a description…"
                    aria-labelledby={`d-desc-${task.id}`}
                    disabled={pending}
                    rows={3}
                  />
                </div>
              </div>

              <SubIssuesPanel
                propertyId={propertyId}
                taskId={task.id}
                status={status}
                adding={addingSubIssue}
                onStartAdd={() => setAddingSubIssue(true)}
                onCancelAdd={() => setAddingSubIssue(false)}
              />

              <ChecklistsPanel propertyId={propertyId} taskId={task.id} />

              <AttachmentsSection
                meta={mutations.meta}
                onUpload={uploadFiles}
                onPick={mutations.openers.attachFile}
                onRemove={mutations.removers.removeAttachment}
              />

              <div className="dsec">
                <div className="tabs g8-task-tabs" role="tablist">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={tab === "comments"}
                    className={cn("tab", tab === "comments" && "on")}
                    onClick={() => setTab("comments")}
                  >
                    Comments<span className="cnt">{threads.length}</span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={tab === "activity"}
                    className={cn("tab", tab === "activity" && "on")}
                    onClick={() => setTab("activity")}
                  >
                    Activity
                  </button>
                  <span className="sp" />
                  <PresenceBar />
                </div>

                {tab === "comments" ? (
                  <div role="tabpanel">
                    {threads.length === 0 ? (
                      <p className="faint g8-task-empty">
                        No comments yet. Start the conversation.
                      </p>
                    ) : (
                      <div className="g8-task-threads">
                        {threads.map((thread) => (
                          <Thread key={thread.id} thread={thread} />
                        ))}
                      </div>
                    )}
                    <div className="cbox g8-lb-composer">
                      <Composer metadata={{ taskId: task.id }} />
                    </div>
                  </div>
                ) : (
                  <div role="tabpanel" className="g8-task-activity">
                    <TaskHistory propertyId={propertyId} taskId={task.id} />
                    {task.createdAt ? (
                      <div className="act-line">
                        <span className="ico">
                          {creator && task.createdBy ? (
                            <Av
                              member={{
                                id: task.createdBy,
                                name: creator.name,
                                avatarUrl: creator.avatar,
                              }}
                            />
                          ) : (
                            <Gi icon={Plus} size={13} />
                          )}
                        </span>
                        <span className="grow">
                          {creator ? (
                            <>
                              <b>{creator.name}</b> created the task
                            </>
                          ) : (
                            "Task created"
                          )}{" "}
                          <WorkflowProvenanceBadge
                            propertyId={propertyId}
                            source={task.source}
                            workflowId={task.sourceWorkflowId}
                            workflowRunId={task.sourceWorkflowRunId}
                          />
                        </span>
                        <time className="faint g8-task-time">
                          {formatRelative(task.createdAt)}
                        </time>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>

              <div className="dsec">
                <TaskAiPanel propertyId={propertyId} taskId={task.id} />
              </div>
            </div>
          </div>
        </div>

        {railOpen ? (
          <>
            {/* Click-away layer: a whisper of tint so the drawer reads as a
                layer, and any click on the task beneath dismisses it. */}
            <button
              type="button"
              aria-label="Close task details"
              onClick={() => setRailOpen(false)}
              className={cn(
                "g8-trail-scrim absolute inset-0 z-10 cursor-default",
                !embedded && "@4xl/task:hidden",
              )}
            />
            <TaskDetailSidebar
              {...sidebarProps}
              className={cn(
                "g8-trail-float absolute inset-y-2 right-2 z-20 max-w-[calc(100%-1rem)]",
                !embedded && "@4xl/task:hidden",
              )}
            />
          </>
        ) : null}
        {embedded ? null : (
          <TaskDetailSidebar
            {...sidebarProps}
            className="hidden @4xl/task:flex"
          />
        )}
      </div>

      {mutations.dialogs}
      {mutations.attachmentInput}
    </div>
  );
}

function autosize(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

function completeTarget(options: ColumnDef[]): string {
  return (
    options.find((o) => o.category === "done")?.id ??
    options.find((o) => o.category === "closed")?.id ??
    "done"
  );
}

function reopenTarget(options: ColumnDef[]): string {
  return (
    options.find((o) => o.category === "open")?.id ??
    options.find((o) => o.category === "unstarted")?.id ??
    "todo"
  );
}

function daysOverdue(iso: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(iso);
  d.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((today.getTime() - d.getTime()) / 86_400_000));
}

/** gr8r FT: a file's kind → glyph + palette token. */
function fileKind(name: string, mime: string | null) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (mime?.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "svg", "heic"].includes(ext))
    return { icon: ImageIcon, c: "var(--g8-teal)", n: "Image", image: true };
  if (mime === "application/pdf" || ext === "pdf")
    return { icon: FileText, c: "var(--g8-red)", n: "PDF", image: false };
  if (["xls", "xlsx", "csv", "numbers"].includes(ext) || mime?.includes("spreadsheet"))
    return { icon: FileSpreadsheet, c: "var(--g8-green)", n: "Spreadsheet", image: false };
  if (["zip", "rar", "7z", "tar", "gz"].includes(ext))
    return { icon: FolderArchive, c: "var(--g8-gray)", n: "Archive", image: false };
  if (["doc", "docx", "txt", "md", "rtf", "pages"].includes(ext))
    return { icon: FileText, c: "var(--g8-blue)", n: "Document", image: false };
  return { icon: FileIcon, c: "var(--g8-gray)", n: "File", image: false };
}

function formatBytes(n: number | null): string {
  if (n == null) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * gr8r's drawer "Attachments" section: an `.att` grid of `.attc` file cards
 * (image previews inline), Upload in the header, and a `.dropzone` when
 * empty. Drop files anywhere on the section to attach them. Slot files
 * (0116 Files fields) are left to their field.
 */
function AttachmentsSection({
  meta,
  onUpload,
  onPick,
  onRemove,
}: {
  meta: TaskDetailMeta | undefined;
  onUpload: (files: FileList | File[]) => Promise<void>;
  onPick: () => void;
  onRemove: (attachmentId: string) => void;
}) {
  const [over, setOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const files = (meta?.attachments ?? []).filter((f) => !f.fieldId);

  function onDragOver(e: DragEvent) {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    setOver(true);
  }
  async function onDrop(e: DragEvent) {
    if (!e.dataTransfer.files.length) return;
    e.preventDefault();
    setOver(false);
    setUploading(true);
    try {
      await onUpload(e.dataTransfer.files);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div
      className="dsec"
      onDragOver={onDragOver}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => void onDrop(e)}
    >
      <div className="dsec-h">
        <h3>Attachments</h3>
        <span className="cnt">{files.length}</span>
        <div className="acts">
          <button
            type="button"
            className={cn("btn btn-sm btn-ghost", uploading && "is-loading")}
            onClick={onPick}
          >
            <Gi icon={Upload} size={13} />
            Upload
          </button>
        </div>
      </div>
      {files.length ? (
        <div className={cn("att", over && "g8-att-over")}>
          {files.map((f) => {
            const k = fileKind(f.fileName, f.mimeType);
            return (
              <div key={f.id} className="attc">
                <a
                  href={f.url || undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="g8-attc-link"
                >
                  <div className="fprev">
                    {k.image && f.url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={f.url} alt="" className="g8-attc-img" />
                    ) : (
                      <span className="ftype" style={cVar(k.c)}>
                        <Gi icon={k.icon} size={14} />
                      </span>
                    )}
                  </div>
                  <div className="fi">
                    <div className="trunc g8-attc-name">{f.fileName}</div>
                    <div className="faint">
                      {k.n}
                      {f.byteSize != null ? ` · ${formatBytes(f.byteSize)}` : ""}
                    </div>
                  </div>
                </a>
                <button
                  type="button"
                  className="ibtn ibtn-xs x"
                  onClick={() => onRemove(f.id)}
                  aria-label={`Remove ${f.fileName}`}
                >
                  <Gi icon={X} size={12} />
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <button
          type="button"
          className={cn("dropzone g8-task-drop", over && "over")}
          onClick={onPick}
        >
          <Gi icon={Paperclip} size={15} />
          <span>{uploading ? "Uploading…" : "Drop files or click to attach"}</span>
        </button>
      )}
    </div>
  );
}
