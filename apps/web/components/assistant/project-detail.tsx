"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Archive,
  Clock,
  FileText,
  Lock,
  MessageSquare,
  MoreVertical,
  Pencil,
  Pin,
  Plus,
  StickyNote,
  Trash2,
  X,
} from "lucide-react";
import { PageHeader } from "@/components/shell/page-header";
import { NewIcon } from "@/components/shell/clickup-icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  assistantProjectsKey,
  assistantResourcesKey,
  assistantResourcesQueryOptions,
} from "@/lib/query/assistant-queries";
import { documentsTreeQueryOptions } from "@/lib/query/section-queries";
import {
  TEXT_RESOURCE_MAX,
  asTint,
  type AssistantChat,
  type AssistantProject,
  type AssistantProjectResource,
} from "@/lib/assistant/types";
import { Gi } from "@/components/gr8r/icon";
import { tintVar } from "@/components/gr8r/ai-glyphs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { AssistantComposer } from "./assistant-composer";
import { seedChat } from "./assistant-workspace";
import { ScheduledCard } from "./scheduled-card";
import {
  addProjectResource,
  archiveProject,
  createChat,
  removeProjectResource,
  updateProject,
} from "./actions";
import { disableSchedulesForProject } from "./schedule-actions";

/**
 * A project's home. Two columns on desktop: the working column (composer +
 * the project's conversations) and a context rail (instructions, memory,
 * attached documents and notes) — the layout Claude's project page uses,
 * because it puts the thing you came to do first and the thing you configure
 * once beside it rather than in front of it.
 *
 * On mobile the rail stacks under the working column: config is the part you
 * touch least, so it is the part that moves below the fold.
 */

export function ProjectDetail({
  propertyId,
  project: initialProject,
  chats,
  timezone,
}: {
  propertyId: string;
  project: AssistantProject;
  chats: AssistantChat[];
  /** The property's IANA zone — the default a new schedule is written in. */
  timezone: string;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const [project, setProject] = useState(initialProject);
  const [input, setInput] = useState("");
  const [starting, setStarting] = useState(false);

  const { data: resources = [] } = useQuery(assistantResourcesQueryOptions(project.id));

  async function patch(next: Partial<AssistantProject>) {
    setProject((prev) => ({ ...prev, ...next }));
    const result = await updateProject({
      projectId: project.id,
      propertyId,
      patch: next as never,
    });
    if ("error" in result) {
      toast.error(result.error);
      setProject(initialProject);
      return;
    }
    void qc.invalidateQueries({ queryKey: assistantProjectsKey(propertyId) });
  }

  async function start(message?: string) {
    if (starting) return;
    setStarting(true);
    try {
      const result = await createChat({
        propertyId,
        projectId: project.id,
        title: message?.slice(0, 140),
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      // Hand off to the tabbed workspace; `?c=` opens it as a tab there.
      // Seed the shared chats cache first: the workspace renders a pane only
      // for rows it can see, and a stale list would show an empty tab until
      // the next refetch.
      seedChat(qc, propertyId, {
        id: result.chatId,
        title: message?.slice(0, 140) || "New chat",
        project_id: project.id,
      });
      setInput("");
      const query = new URLSearchParams({ c: result.chatId });
      if (message) {
        // The workspace can't carry a draft across a navigation, so the chat
        // opens empty and the message is sent from there via `?send=`.
        query.set("send", message);
      }
      router.push(`/p/${propertyId}/assistant?${query.toString()}`);
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        breadcrumbs={[
          {
            label: "Assistant",
            href: `/p/${propertyId}/assistant`,
            icon: <NewIcon />,
          },
          { label: "Projects", href: `/p/${propertyId}/assistant/projects` },
          { label: project.name },
        ]}
        actions={
          <div className="row" style={{ gap: 2 }}>
            <button
              type="button"
              className={project.pinned ? "ibtn ibtn-sm on" : "ibtn ibtn-sm"}
              aria-label={project.pinned ? "Unpin project" : "Pin project"}
              aria-pressed={project.pinned}
              title={project.pinned ? "Unpin project" : "Pin project"}
              onClick={() => void patch({ pinned: !project.pinned })}
            >
              <Pin
                size={15}
                strokeWidth={1.8}
                className={cn("i", project.pinned && "fill-current")}
              />
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label="Project actions"
                className="ibtn ibtn-sm"
              >
                <Gi icon={MoreVertical} size={15} />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-40">
                <DropdownMenuItem
                  variant="destructive"
                  onClick={async () => {
                    // Stop the schedules FIRST: an archived project whose
                    // workflows keep firing produces nothing but skipped runs.
                    await disableSchedulesForProject({
                      propertyId,
                      projectId: project.id,
                    });
                    const result = await archiveProject({
                      projectId: project.id,
                      propertyId,
                    });
                    if ("error" in result) {
                      toast.error(result.error);
                      return;
                    }
                    void qc.invalidateQueries({
                      queryKey: assistantProjectsKey(propertyId),
                    });
                    router.push(`/p/${propertyId}/assistant/projects`);
                  }}
                >
                  <Archive className="size-4" />
                  Archive project
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="page wide" style={{ maxWidth: 1200 }}>
          <header className="ph">
            <span
              className="picon lg"
              style={{ ...tintVar(asTint(project.tint)), fontSize: 18 } as React.CSSProperties}
            >
              {project.emoji}
            </span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <h1>{project.name}</h1>
              {project.description ? <p>{project.description}</p> : null}
            </div>
          </header>

          {/* A CONTAINER query, not a viewport breakpoint. The shell's rail +
              secondary sidebar eat ~364px, so `lg:` (a 1024px viewport) leaves
              this page barely 660px — the split fired there and squeezed the
              composer to ~350px, wrapping its own placeholder. The split should
              depend on the space this page actually has. */}
          <div className="@container">
          <div className="grid gap-6 @3xl:grid-cols-[minmax(0,1fr)_340px]">
            {/* Working column */}
            <div className="min-w-0">
              <AssistantComposer
                size="hero"
                autoFocus
                propertyId={propertyId}
                value={input}
                onChange={setInput}
                onSubmit={() => {
                  const message = input.trim();
                  if (!message) return;
                  // Cleared only once the chat exists — see `start`.
                  void start(message);
                }}
                busy={starting}
                placeholder={`Ask anything about ${project.name}…`}
              />

              {/* Recents. Rows are separated by hairlines and run tall (44px of
                  content + padding) — at this width a dense list reads as a
                  dropdown, not as the body of the page. */}
              <section className="panel" style={{ marginTop: 24 }}>
                <div className="panel-h">
                  <h2>Recents</h2>
                  {chats.length ? <span className="faint" style={{ fontSize: "var(--g8-fs-xs)" }}>{chats.length}</span> : null}
                </div>
                {chats.length === 0 ? (
                  <div className="empty-state sm">
                    <div className="glyph">
                      <Gi icon={MessageSquare} />
                    </div>
                    <p>
                      Nothing here yet. Anything you ask in this project inherits
                      its instructions, memory, and context.
                    </p>
                  </div>
                ) : (
                  <ul role="list" style={{ margin: 0, padding: 0, listStyle: "none" }}>
                    {chats.map((chat) => (
                      <li key={chat.id}>
                        <Link
                          href={`/p/${propertyId}/assistant?c=${chat.id}`}
                          className="mini"
                          style={{ minHeight: 44 }}
                        >
                          {/* A scheduled brief appears without anyone opening
                              it, so the icon has to say where it came from —
                              otherwise it reads as a conversation you forgot
                              having. */}
                          {chat.source === "scheduled" ? (
                            <span aria-label="Scheduled run" className="row faint">
                              <Gi icon={Clock} size={15} />
                            </span>
                          ) : (
                            <Gi icon={MessageSquare} size={15} className="faint" />
                          )}
                          <span className="tt">{chat.title}</span>
                          <time
                            className="due"
                            dateTime={chat.last_message_at}
                            title={new Date(chat.last_message_at).toLocaleString()}
                          >
                            {formatRecency(chat.last_message_at)}
                          </time>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>

            {/* Context rail — ONE card with hairline-divided sections, not three
                floating cards. Three cards read as three unrelated widgets; the
                reference groups them because they are one thing: what this
                project knows before you type. */}
            <aside className="panel g8-ai-rail @3xl:sticky @3xl:top-6 h-fit">
              <TextSection
                title="Instructions"
                hint="How the assistant should work here — tone, format, standing rules."
                value={project.instructions}
                placeholder="Always cite the document you took a policy from. Prices in KES."
                onSave={(instructions) => patch({ instructions })}
              />
              <TextSection
                title="Memory"
                hint="Durable facts this project carries between conversations."
                badge="Only you"
                value={project.memory}
                placeholder="The villa has four bedrooms. Grace is the head housekeeper."
                onSave={(memory) => patch({ memory })}
              />
              <ContextSection
                propertyId={propertyId}
                projectId={project.id}
                resources={resources}
              />
              <ScheduledCard
                propertyId={propertyId}
                projectId={project.id}
                projectName={project.name}
                timezone={timezone}
              />
            </aside>
          </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** "9 hours ago" while it's today-ish, then a plain date — the reference's
 *  mix, which reads faster than either format alone for a recency list. */
function formatRecency(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const mins = Math.floor((Date.now() - then) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const d = new Date(then);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

/**
 * One long-form field as a section of the rail card. Reads as prose until you
 * click edit — the configured value is the thing worth showing, not the form.
 * Collapsed to three lines so a long memory can't push Context off the screen;
 * the whole point of the rail is that all of it is visible at once.
 */
function TextSection({
  title,
  hint,
  badge,
  value,
  placeholder,
  onSave,
}: {
  title: string;
  hint: string;
  /** Small right-aligned qualifier, e.g. Memory's "Only you". */
  badge?: string;
  value: string | null;
  placeholder: string;
  onSave: (value: string | null) => void | Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState(value ?? "");

  return (
    <section>
      <div className="panel-h">
        <h2>{title}</h2>
        <div className="acts">
          {badge ? (
            <span className="badge gray">
              <Gi icon={Lock} size={11} />
              {badge}
            </span>
          ) : null}
          {!editing ? (
            <button
              type="button"
              className="ibtn ibtn-sm"
              aria-label={`${value ? "Edit" : "Add"} ${title.toLowerCase()}`}
              onClick={() => {
                setDraft(value ?? "");
                setEditing(true);
              }}
            >
              {value ? <Gi icon={Pencil} size={13} /> : <Gi icon={Plus} size={15} />}
            </button>
          ) : null}
        </div>
      </div>

      {editing ? (
        <div className="panel-b flex flex-col gap-2">
          <textarea
            className="textarea"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={placeholder}
            rows={6}
            autoFocus
          />
          <div className="row" style={{ justifyContent: "flex-end", gap: 6 }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={async () => {
                await onSave(draft.trim() || null);
                setEditing(false);
              }}
            >
              Save
            </button>
          </div>
        </div>
      ) : value ? (
        <div className="panel-b">
          <p
            className={cn("whitespace-pre-line", !expanded && "line-clamp-3")}
            style={{ margin: 0, fontSize: "var(--g8-fs-sm)", lineHeight: 1.55, color: "var(--g8-text-2)" }}
          >
            {value}
          </p>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="link"
            style={{ marginTop: 4, fontSize: "var(--g8-fs-xs)" }}
          >
            {expanded ? "Show less" : "Show more"}
          </button>
        </div>
      ) : (
        <p className="panel-b muted" style={{ margin: 0, fontSize: "var(--g8-fs-sm)" }}>{hint}</p>
      )}
    </section>
  );
}

/**
 * Attached context. Documents are stored as REFERENCES, not copies — the
 * assistant reads the live document with `read_document` when it's relevant,
 * so an SOP edited this morning is the version it answers from. Pasted notes
 * are inlined into the session prompt instead, since they have no other home.
 */
function ContextSection({
  propertyId,
  projectId,
  resources,
}: {
  propertyId: string;
  projectId: string;
  resources: AssistantProjectResource[];
}) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState<"document" | "text" | null>(null);

  async function remove(resourceId: string) {
    const result = await removeProjectResource({ resourceId });
    if ("error" in result) {
      toast.error(result.error);
      return;
    }
    void qc.invalidateQueries({ queryKey: assistantResourcesKey(projectId) });
  }

  return (
    <section>
      <div className="panel-h">
        <h2>Context</h2>
        <div className="acts">
        {/* A single `+` opening a menu, matching the other sections' affordance
            — two text buttons made this header the loudest thing in the rail. */}
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="Add context"
            className="ibtn ibtn-sm"
          >
            <Gi icon={Plus} size={15} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-44">
            <DropdownMenuItem onClick={() => setAdding("document")}>
              <FileText className="size-4" />
              Attach a document
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setAdding("text")}>
              <StickyNote className="size-4" />
              Add a note
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        </div>
      </div>

      <div className="panel-b">
      {resources.length === 0 ? (
        <button
          type="button"
          onClick={() => setAdding("document")}
          className="dropzone"
          style={{ width: "100%" }}
        >
          <span className="row" style={{ justifyContent: "center", gap: 4, color: "var(--g8-text-4)" }} aria-hidden>
            <Gi icon={FileText} size={18} />
            <Gi icon={FileText} size={22} />
            <Gi icon={FileText} size={18} />
          </span>
          <span className="muted" style={{ fontSize: "var(--g8-fs-sm)" }}>
            Attach documents or notes for this project to always have to hand.
          </span>
        </button>
      ) : (
        <ul role="list" className="flex flex-col gap-0.5" style={{ margin: 0, padding: 0, listStyle: "none" }}>
          {resources.map((resource) => (
            <li
              key={resource.id}
              className="group mi"
            >
              {resource.kind === "document" ? (
                <Gi icon={FileText} size={14} />
              ) : (
                <Gi icon={StickyNote} size={14} />
              )}
              <span className="trunc grow">{resource.title}</span>
              <button
                type="button"
                onClick={() => void remove(resource.id)}
                aria-label={`Remove ${resource.title}`}
                className="ibtn ibtn-xs opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
              >
                <Gi icon={Trash2} size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {resources.length > 0 ? (
        <p className="faint" style={{ margin: "8px 0 0", fontSize: "var(--g8-fs-xs)" }}>
          Documents stay live — the assistant reads the current version.
        </p>
      ) : null}
      </div>

      <AddResourceDialog
        propertyId={propertyId}
        projectId={projectId}
        kind={adding}
        onClose={() => setAdding(null)}
      />
    </section>
  );
}

function AddResourceDialog({
  propertyId,
  projectId,
  kind,
  onClose,
}: {
  propertyId: string;
  projectId: string;
  kind: "document" | "text" | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");

  const { data: tree } = useQuery({
    ...documentsTreeQueryOptions(propertyId),
    enabled: kind === "document",
  });

  const documents = (tree ?? [])
    .filter((doc) => doc.title.toLowerCase().includes(search.toLowerCase()))
    .slice(0, 40);

  async function submit() {
    if (saving || !kind) return;
    setSaving(true);
    try {
      const result = await addProjectResource({
        projectId,
        propertyId,
        kind,
        documentId: documentId ?? undefined,
        title: title.trim(),
        body,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      await qc.invalidateQueries({ queryKey: assistantResourcesKey(projectId) });
      setTitle("");
      setBody("");
      setDocumentId(null);
      setSearch("");
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={kind !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {kind === "document" ? "Attach a document" : "Add a note"}
          </DialogTitle>
        </DialogHeader>

        {kind === "document" ? (
          <div className="flex flex-col gap-2">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search documents…"
              autoFocus
            />
            <ul
              role="list"
              className="max-h-72 overflow-y-auto rounded-md bg-muted p-1"
            >
              {documents.length === 0 ? (
                <li className="px-2 py-3 text-sm text-muted-foreground">
                  No documents match.
                </li>
              ) : (
                documents.map((doc) => (
                  <li key={doc.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setDocumentId(doc.id);
                        setTitle(doc.title);
                      }}
                      aria-pressed={documentId === doc.id}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent",
                        documentId === doc.id && "bg-accent-pressed",
                      )}
                    >
                      <FileText className="size-3.5 shrink-0 text-faint-foreground" />
                      <span className="min-w-0 truncate">{doc.title}</span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="note-title" className="text-sm font-medium">
                Title
              </label>
              <Input
                id="note-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Owner preferences"
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="note-body" className="text-sm font-medium">
                Text
              </label>
              <Textarea
                id="note-body"
                value={body}
                onChange={(e) => setBody(e.target.value.slice(0, TEXT_RESOURCE_MAX))}
                rows={8}
                placeholder="Paste anything the assistant should always know here."
              />
              <p className="text-xs text-faint-foreground">
                {body.length.toLocaleString()} / {TEXT_RESOURCE_MAX.toLocaleString()}{" "}
                characters
              </p>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            <X className="size-4" />
            Cancel
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={
              saving ||
              !title.trim() ||
              (kind === "document" ? !documentId : !body.trim())
            }
          >
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
