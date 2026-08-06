"use client";

import { useCallback, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useThreads } from "@liveblocks/react/suspense";
import { Composer, Thread } from "@liveblocks/react-ui";
import "@liveblocks/react-ui/styles.css";
import { ListChecks, Paperclip, Smile } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { deleteTask, escalateTask, updateTask } from "./actions";
import { PageHeader } from "@/components/shell/page-header";
import { PageShell } from "@/components/ui/page-shell";
import { PresenceBar } from "./presence-bar";
import { taskShortId } from "./kanban";
import {
  SubIssuesPanel,
  TaskDetailSidebar,
} from "./task-detail-sidebar";
import { TaskDetailInlineProperties } from "./task-detail-inline-properties";
import { TaskAiPanel } from "./task-ai-panel";
import { TaskTriageSuggestions } from "./task-triage-suggestions";
import { useTaskDetailMutations } from "./task-detail-mutations";
import { propertyMembersQueryOptions } from "@/lib/query/section-queries";
import { useAssigneesMap } from "@/lib/tasks/use-assignees";
import { taskHref } from "@/lib/tasks/task-href";
import { WorkflowProvenanceBadge } from "@/components/workflows/provenance-badge";
import type { TaskPriority, TaskStatus } from "@/lib/db/types";

type Task = {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeId: string | null;
  dueAt: string | null;
  createdAt?: string;
  /** Who opened the task (migration 0001 `created_by`). */
  createdBy?: string | null;
  /** Creation provenance (migration 0050). */
  source?: string | null;
  sourceWorkflowId?: string | null;
  sourceWorkflowRunId?: string | null;
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
}: {
  propertyId: string;
  task: Task;
}) {
  const qc = useQueryClient();
  const router = useRouter();
  const { threads } = useThreads();
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [status, setStatus] = useState<TaskStatus>(task.status);
  const [priority, setPriority] = useState<TaskPriority>(task.priority);
  const [assigneeId, setAssigneeId] = useState<string | null>(task.assigneeId);
  const [dueAt, setDueAt] = useState<string | null>(task.dueAt);
  const [addingSubIssue, setAddingSubIssue] = useState(false);
  const [pending, startTransition] = useTransition();
  const savedTitle = useRef(task.title);
  const savedDescription = useRef(task.description ?? "");

  const assignees = useAssigneesMap([assigneeId, task.createdBy]);
  const assignee = assigneeId ? assignees[assigneeId] : undefined;
  const creator = task.createdBy ? assignees[task.createdBy] : undefined;

  const { data: members = [] } = useQuery(
    propertyMembersQueryOptions(propertyId),
  );

  const mutations = useTaskDetailMutations(propertyId, task.id);

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

  function saveStatus(next: TaskStatus) {
    setStatus(next);
    persist({ taskId: task.id, status: next });
  }

  function savePriority(next: TaskPriority) {
    setPriority(next);
    persist({ taskId: task.id, priority: next });
  }

  function saveAssignee(next: string | null) {
    setAssigneeId(next);
    persist({ taskId: task.id, assigneeId: next });
  }

  function saveDueAt(next: string | null) {
    setDueAt(next);
    persist({ taskId: task.id, dueAt: next });
  }

  function copyTaskLink() {
    const url =
      typeof window !== "undefined"
        ? window.location.href
        : taskHref(propertyId, task.id);
    void navigator.clipboard.writeText(url);
    toast.success("Link copied");
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

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        breadcrumbs={[
          {
            label: "Tasks",
            href: `/p/${propertyId}/tasks`,
            icon: <ListChecks />,
          },
          { label: taskShortId(task.id) },
        ]}
      />
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex-1 overflow-y-auto">
            {/* One page width for the whole column (PageShell owns it), pushed
                down from the top so the title gets the same "page header"
                breathing room Linear gives its work item view. */}
            <PageShell className="px-10 pt-16 pb-12">
            <textarea
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={saveTitle}
              rows={1}
              aria-label="Task title"
              disabled={pending}
              className={cn(
                "w-full resize-none border-0 bg-transparent p-0",
                "text-2xl leading-8 font-semibold text-foreground",
                "focus-visible:outline-none",
              )}
            />

            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={saveDescription}
              placeholder="Add description…"
              aria-label="Task description"
              disabled={pending}
              rows={3}
              className={cn(
                "mt-3 w-full resize-none border-0 bg-transparent p-0",
                // Reading content sits on the 16px/24px body rung
                "text-base leading-6 text-foreground",
                "placeholder:text-faint-foreground",
                "focus-visible:outline-none",
              )}
            />

            <TaskDetailInlineProperties
              propertyId={propertyId}
              status={status}
              priority={priority}
              assigneeId={assigneeId}
              assignee={assignee}
              dueAt={dueAt}
              members={members}
              meta={mutations.meta}
              openers={mutations.openers}
              removers={mutations.removers}
              onStatusChange={saveStatus}
              onPriorityChange={savePriority}
              onAssigneeChange={saveAssignee}
              onDueAtChange={saveDueAt}
            />

            <div className="mt-3">
              <TaskTriageSuggestions propertyId={propertyId} taskId={task.id} />
            </div>

            <div className="mt-4 flex items-center gap-1">
              <IconGhostButton label="Add reaction">
                <Smile className="size-4" />
              </IconGhostButton>
              <IconGhostButton
                label="Attach file"
                onClick={mutations.openers.attachFile}
              >
                <Paperclip className="size-4" />
              </IconGhostButton>
            </div>

            <SubIssuesPanel
              propertyId={propertyId}
              taskId={task.id}
              status={status}
              adding={addingSubIssue}
              onStartAdd={() => setAddingSubIssue(true)}
              onCancelAdd={() => setAddingSubIssue(false)}
            />

            <section className="mt-10 border-t border-border pt-6">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="text-sm font-medium text-foreground">
                  Activity
                </h2>
                <PresenceBar />
              </div>

              {task.createdAt ? (
                <div className="mb-4 flex items-start gap-2.5 text-sm">
                  <span className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs/[1] font-medium text-faint-foreground">
                    ·
                  </span>
                  <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-muted-foreground">
                    <span className="text-foreground">Task created</span>
                    {creator ? (
                      <span>
                        by{" "}
                        <span className="text-foreground">
                          {creator.name}
                        </span>
                      </span>
                    ) : null}
                    <WorkflowProvenanceBadge
                      propertyId={propertyId}
                      source={task.source}
                      workflowId={task.sourceWorkflowId}
                      workflowRunId={task.sourceWorkflowRunId}
                    />
                    {" · "}
                    {formatRelative(task.createdAt)}
                  </p>
                </div>
              ) : null}

              <div className="space-y-3">
                {threads.map((thread) => (
                  <Thread key={thread.id} thread={thread} />
                ))}
              </div>

              <div className="mt-4 rounded-md bg-muted p-1">
                <Composer metadata={{ taskId: task.id }} />
              </div>

              <TaskAiPanel propertyId={propertyId} taskId={task.id} />
            </section>
            </PageShell>
          </div>
        </div>

        <TaskDetailSidebar
          propertyId={propertyId}
          taskId={task.id}
          status={status}
          priority={priority}
          assigneeId={assigneeId}
          assignee={assignee}
          dueAt={dueAt}
          members={members}
          meta={mutations.meta}
          openers={mutations.openers}
          removers={mutations.removers}
          onStatusChange={saveStatus}
          onPriorityChange={savePriority}
          onAssigneeChange={saveAssignee}
          onDueAtChange={saveDueAt}
          onCopyTitle={copyTitle}
          onCopyLink={copyTaskLink}
          onDelete={removeTask}
          onEscalate={escalate}
          onAddSubIssue={() => setAddingSubIssue(true)}
          onAutomate={automateFromTask}
        />
      </div>

      {mutations.dialogs}
      {mutations.attachmentInput}
    </div>
  );
}

function IconGhostButton({
  label,
  children,
  onClick,
}: {
  label: string;
  children: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent"
    >
      {children}
    </button>
  );
}
