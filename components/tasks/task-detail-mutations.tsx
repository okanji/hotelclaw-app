"use client";

import {
  useCallback,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactElement,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FileText } from "lucide-react";
import { toast } from "sonner";
import { StatusIcon } from "./task-icons";
import {
  addTaskLabel,
  addTaskLink,
  addTaskRelation,
  addTaskReminder,
  linkTaskDocument,
  removeTaskAttachment,
  removeTaskLabel,
  removeTaskLink,
  removeTaskRelation,
  setTaskProject,
  toggleTaskFavorite,
  toggleTaskMute,
  unlinkTaskDocument,
} from "./task-detail-actions";
import {
  documentsQueryOptions,
  taskDetailMetaQueryOptions,
  tasksQueryOptions,
} from "@/lib/query/section-queries";
import type { TaskDetailMeta } from "@/lib/tasks/task-detail-meta";

/**
 * Openers map for the heavy task-detail dialogs. Multiple surfaces — the
 * sidebar, the inline Linear-style properties row — drive the same dialogs,
 * so the state and the rendered <Dialog>s are lifted into a single hook.
 */
export type TaskDetailOpeners = {
  addLink: () => void;
  addLabel: () => void;
  addProject: () => void;
  createRelated: () => void;
  addDocument: () => void;
  remindMe: () => void;
  showHistory: () => void;
  attachFile: () => void;
};

export type TaskDetailRemovers = {
  removeLink: (linkId: string) => void;
  removeLabel: (label: string) => void;
  removeProject: () => void;
  removeRelation: (relationId: string) => void;
  unlinkDocument: (linkId: string) => void;
  removeAttachment: (attachmentId: string) => void;
  toggleFavorite: () => void;
  toggleMute: () => void;
};

export type TaskDetailMutations = {
  meta: TaskDetailMeta | undefined;
  metaPending: boolean;
  pending: boolean;
  openers: TaskDetailOpeners;
  removers: TaskDetailRemovers;
  dialogs: ReactElement;
  attachmentInput: ReactElement;
};

function normalizeUrl(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

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
  return new Date(iso).toLocaleDateString();
}

export function useTaskDetailMutations(
  propertyId: string,
  taskId: string,
): TaskDetailMutations {
  const qc = useQueryClient();
  const [pending, startTransition] = useTransition();

  const { data: meta, isPending: metaPending } = useQuery(
    taskDetailMetaQueryOptions(propertyId, taskId),
  );
  const { data: allTasks = [] } = useQuery(tasksQueryOptions(propertyId));
  const { data: documents = [] } = useQuery(documentsQueryOptions(propertyId));

  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkTitle, setLinkTitle] = useState("");
  const [labelOpen, setLabelOpen] = useState(false);
  const [labelValue, setLabelValue] = useState("");
  const [projectOpen, setProjectOpen] = useState(false);
  const [projectValue, setProjectValue] = useState("");
  const [relatedOpen, setRelatedOpen] = useState(false);
  const [relatedSearch, setRelatedSearch] = useState("");
  const [documentOpen, setDocumentOpen] = useState(false);
  const [reminderOpen, setReminderOpen] = useState(false);
  const [reminderAt, setReminderAt] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const invalidateMeta = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["task-meta", propertyId, taskId] });
    qc.invalidateQueries({ queryKey: ["tasks", propertyId] });
  }, [qc, propertyId, taskId]);

  const runAction = useCallback(
    (fn: () => Promise<{ error: string } | { ok?: true }>) => {
      startTransition(async () => {
        const result = await fn();
        if ("error" in result && result.error) {
          toast.error(result.error);
          return;
        }
        invalidateMeta();
      });
    },
    [invalidateMeta],
  );

  const openers = useMemo<TaskDetailOpeners>(
    () => ({
      addLink: () => {
        setLinkUrl("");
        setLinkTitle("");
        setLinkOpen(true);
      },
      addLabel: () => {
        setLabelValue("");
        setLabelOpen(true);
      },
      addProject: () => {
        setProjectValue("");
        setProjectOpen(true);
      },
      createRelated: () => {
        setRelatedSearch("");
        setRelatedOpen(true);
      },
      addDocument: () => setDocumentOpen(true),
      remindMe: () => {
        setReminderAt("");
        setReminderOpen(true);
      },
      showHistory: () => setHistoryOpen(true),
      attachFile: () => fileInputRef.current?.click(),
    }),
    [],
  );

  const removers = useMemo<TaskDetailRemovers>(
    () => ({
      removeLink: (linkId) =>
        runAction(async () => {
          const result = await removeTaskLink(linkId);
          if ("error" in result) return result;
          toast.success("Link removed");
          return result;
        }),
      removeLabel: (label) =>
        runAction(async () => {
          const result = await removeTaskLabel(taskId, label);
          if ("error" in result) return result;
          toast.success("Label removed");
          return result;
        }),
      removeProject: () =>
        runAction(async () => {
          const result = await setTaskProject({ taskId, projectName: null });
          if ("error" in result) return result;
          toast.success("Removed from project");
          return result;
        }),
      removeRelation: (relationId) =>
        runAction(async () => {
          const result = await removeTaskRelation(relationId);
          if ("error" in result) return result;
          toast.success("Relation removed");
          return result;
        }),
      unlinkDocument: (linkId) =>
        runAction(async () => {
          const result = await unlinkTaskDocument(linkId);
          if ("error" in result) return result;
          toast.success("Document unlinked");
          return result;
        }),
      removeAttachment: (attachmentId) =>
        runAction(async () => {
          const result = await removeTaskAttachment(attachmentId);
          if ("error" in result) return result;
          toast.success("Attachment removed");
          return result;
        }),
      toggleFavorite: () =>
        runAction(async () => {
          const result = await toggleTaskFavorite(taskId);
          if ("error" in result) return result;
          toast.success(
            result.favorited
              ? "Added to favorites"
              : "Removed from favorites",
          );
          return result;
        }),
      toggleMute: () =>
        runAction(async () => {
          const result = await toggleTaskMute(taskId);
          if ("error" in result) return result;
          toast.success(
            result.muted
              ? "Unsubscribed from updates"
              : "Subscribed to updates",
          );
          return result;
        }),
    }),
    [runAction, taskId],
  );

  function commitLink() {
    const url = normalizeUrl(linkUrl);
    if (!url) {
      toast.error("Enter a URL");
      return;
    }
    runAction(async () => {
      const result = await addTaskLink({
        taskId,
        url,
        title: linkTitle.trim() || undefined,
      });
      if ("error" in result) return result;
      toast.success("Link added");
      setLinkOpen(false);
      return result;
    });
  }

  function commitLabel() {
    const label = labelValue.trim();
    if (!label) return;
    runAction(async () => {
      const result = await addTaskLabel({ taskId, label });
      if ("error" in result) return result;
      toast.success("Label added");
      setLabelOpen(false);
      return result;
    });
  }

  function commitProject() {
    const projectName = projectValue.trim();
    if (!projectName) return;
    runAction(async () => {
      const result = await setTaskProject({ taskId, projectName });
      if ("error" in result) return result;
      toast.success("Added to project");
      setProjectOpen(false);
      return result;
    });
  }

  function commitReminder() {
    if (!reminderAt) return;
    const iso = new Date(reminderAt).toISOString();
    runAction(async () => {
      const result = await addTaskReminder({ taskId, remindAt: iso });
      if ("error" in result) return result;
      toast.success("Reminder set");
      setReminderOpen(false);
      return result;
    });
  }

  function commitRelation(relatedTaskId: string) {
    runAction(async () => {
      const result = await addTaskRelation({ taskId, relatedTaskId });
      if ("error" in result) return result;
      toast.success("Related task linked");
      setRelatedOpen(false);
      return result;
    });
  }

  function commitDocument(documentId: string) {
    runAction(async () => {
      const result = await linkTaskDocument({ taskId, documentId });
      if ("error" in result) return result;
      toast.success("Document linked");
      setDocumentOpen(false);
      return result;
    });
  }

  const relatedCandidates = allTasks.filter((t) => {
    if (t.id === taskId) return false;
    if (t.parent_id === taskId) return false;
    if (meta?.relatedTasks.some((r) => r.id === t.id)) return false;
    const needle = relatedSearch.trim().toLowerCase();
    if (needle && !t.title.toLowerCase().includes(needle)) return false;
    return true;
  });

  const linkedDocIds = new Set((meta?.documents ?? []).map((d) => d.documentId));
  const documentCandidates = documents.filter((d) => !linkedDocIds.has(d.id));

  const attachmentInput = (
    <input
      ref={fileInputRef}
      type="file"
      className="hidden"
      onChange={(e) => {
        const file = e.target.files?.[0];
        e.target.value = "";
        if (!file) return;
        startTransition(async () => {
          const body = new FormData();
          body.append("file", file);
          const res = await fetch(
            `/api/properties/${propertyId}/tasks/${taskId}/attachments`,
            { method: "POST", body },
          );
          if (!res.ok) {
            const data = (await res.json()) as { error?: string };
            toast.error(data.error ?? "Upload failed");
            return;
          }
          toast.success("File attached");
          invalidateMeta();
        });
      }}
    />
  );

  const dialogs = (
    <>
      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add link</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid gap-1.5">
              <Label htmlFor="task-link-url">URL</Label>
              <Input
                id="task-link-url"
                placeholder="https://…"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitLink();
                  }
                }}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="task-link-title">Title (optional)</Label>
              <Input
                id="task-link-title"
                placeholder="Display name"
                value={linkTitle}
                onChange={(e) => setLinkTitle(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLinkOpen(false)}>
              Cancel
            </Button>
            <Button onClick={commitLink} disabled={pending}>
              Add link
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={labelOpen} onOpenChange={setLabelOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Add label</DialogTitle>
          </DialogHeader>
          <Input
            placeholder="Label name"
            value={labelValue}
            onChange={(e) => setLabelValue(e.target.value)}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitLabel();
              }
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setLabelOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={pending || !labelValue.trim()}
              onClick={commitLabel}
            >
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={projectOpen} onOpenChange={setProjectOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Add to project</DialogTitle>
          </DialogHeader>
          <Input
            placeholder="Project name"
            value={projectValue}
            onChange={(e) => setProjectValue(e.target.value)}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitProject();
              }
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setProjectOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={pending || !projectValue.trim()}
              onClick={commitProject}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={relatedOpen} onOpenChange={setRelatedOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Link related task</DialogTitle>
          </DialogHeader>
          <Input
            placeholder="Search tasks…"
            value={relatedSearch}
            onChange={(e) => setRelatedSearch(e.target.value)}
            autoFocus
          />
          <div className="max-h-56 overflow-y-auto rounded-md border border-border/60">
            {relatedCandidates.length === 0 ? (
              <p className="px-3 py-4 text-center text-[0.8125rem] text-muted-foreground">
                No tasks to link
              </p>
            ) : (
              relatedCandidates.slice(0, 20).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-[0.8125rem] hover:bg-foreground/[0.06]"
                  onClick={() => commitRelation(t.id)}
                >
                  <StatusIcon status={t.status} className="size-3.5" />
                  <span className="truncate">{t.title}</span>
                </button>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={documentOpen} onOpenChange={setDocumentOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Link document</DialogTitle>
          </DialogHeader>
          <div className="max-h-56 overflow-y-auto rounded-md border border-border/60">
            {documentCandidates.length === 0 ? (
              <p className="px-3 py-4 text-center text-[0.8125rem] text-muted-foreground">
                {documents.length === 0
                  ? "No documents yet"
                  : "All documents already linked"}
              </p>
            ) : (
              documentCandidates.map((doc) => (
                <button
                  key={doc.id}
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-[0.8125rem] hover:bg-foreground/[0.06]"
                  onClick={() => commitDocument(doc.id)}
                >
                  <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{doc.title}</span>
                </button>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={reminderOpen} onOpenChange={setReminderOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Remind me</DialogTitle>
          </DialogHeader>
          <Input
            type="datetime-local"
            value={reminderAt}
            onChange={(e) => setReminderAt(e.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setReminderOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={pending || !reminderAt}
              onClick={commitReminder}
            >
              Set reminder
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Description history</DialogTitle>
          </DialogHeader>
          {metaPending ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : !meta?.descriptionRevisions.length ? (
            <p className="text-sm text-muted-foreground">
              No previous versions yet. Edits are saved automatically.
            </p>
          ) : (
            <div className="max-h-80 space-y-3 overflow-y-auto">
              {meta.descriptionRevisions.map((rev) => (
                <div
                  key={rev.id}
                  className="rounded-md border border-border/60 p-3 text-[0.8125rem]"
                >
                  <p className="mb-1 text-[0.75rem] text-muted-foreground">
                    {formatRelative(rev.createdAt)}
                  </p>
                  <p className="whitespace-pre-wrap text-foreground">
                    {rev.description?.trim() || (
                      <span className="text-muted-foreground italic">Empty</span>
                    )}
                  </p>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );

  return {
    meta,
    metaPending,
    pending,
    openers,
    removers,
    dialogs,
    attachmentInput,
  };
}
