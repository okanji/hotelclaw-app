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
import { TintIcon } from "@/components/ui/tint-card";
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
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-workspace px-10 py-8">
        <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
          <Link
            href={`/p/${propertyId}/assistant/projects`}
            className="hover:text-foreground"
          >
            Projects
          </Link>
          <span aria-hidden className="px-1.5 text-faint-foreground">
            /
          </span>
          <span className="text-foreground">{project.name}</span>
        </nav>

        {/* Masthead. The icon sits ABOVE the title rather than beside it —
            Notion's page-icon placement — which lets the title, description and
            everything below share one left edge instead of being indented past
            a tile. Title runs at the page tier (40/48/700, `SectionHeader`
            size="page"): the reference sets this in a serif display face, but
            `font-serif` is guest-world only (DESIGN.md §Type), so the house
            sans carries the same scale and weight instead. */}
        <header className="mt-5 flex items-start gap-4">
          <div className="min-w-0 flex-1">
            <TintIcon tone={asTint(project.tint)} className="text-base">
              {project.emoji}
            </TintIcon>
            <h1 className="mt-3 text-[2.5rem] leading-[3rem] font-bold text-balance text-foreground">
              {project.name}
            </h1>
            {project.description ? (
              <p className="mt-2 max-w-prose text-base leading-relaxed text-pretty text-muted-foreground">
                {project.description}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-0.5 pt-1">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={project.pinned ? "Unpin project" : "Pin project"}
              aria-pressed={project.pinned}
              title={project.pinned ? "Unpin project" : "Pin project"}
              onClick={() => void patch({ pinned: !project.pinned })}
            >
              <Pin
                className={cn("size-4", project.pinned && "fill-current text-foreground")}
              />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label="Project actions"
                render={<Button variant="ghost" size="icon-sm" />}
              >
                <MoreVertical className="size-4" />
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
        </header>

        {/* A CONTAINER query, not a viewport breakpoint. The shell's rail +
            secondary sidebar eat ~364px, so `lg:` (a 1024px viewport) leaves
            this page barely 660px — the split fired there and squeezed the
            composer to ~350px, wrapping its own placeholder. The split should
            depend on the space this page actually has. */}
        <div className="@container mt-8">
        <div className="grid gap-10 @3xl:grid-cols-[minmax(0,1fr)_360px]">
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
                setInput("");
                void start(message);
              }}
              busy={starting}
              placeholder={`Ask anything about ${project.name}…`}
            />

            {/* Recents. Rows are separated by hairlines and run tall (44px of
                content + padding) — at this width a dense list reads as a
                dropdown, not as the body of the page. */}
            <section className="mt-8">
              <h2 className="text-sm text-muted-foreground">Recents</h2>
              {chats.length === 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">
                  Nothing here yet. Anything you ask in this project inherits
                  its instructions, memory, and context.
                </p>
              ) : (
                <ul role="list" className="mt-1 flex flex-col divide-y divide-border">
                  {chats.map((chat) => (
                    <li key={chat.id}>
                      <Link
                        href={`/p/${propertyId}/assistant?c=${chat.id}`}
                        className="-mx-2 flex items-center gap-3 rounded-md px-2 py-3.5 transition-colors hover:bg-accent"
                      >
                        {/* A scheduled brief appears without anyone opening
                            it, so the icon has to say where it came from —
                            otherwise it reads as a conversation you forgot
                            having. */}
                        {chat.source === "scheduled" ? (
                          <Clock
                            className="size-4 shrink-0 text-faint-foreground"
                            aria-label="Scheduled run"
                          />
                        ) : (
                          <MessageSquare className="size-4 shrink-0 text-faint-foreground" />
                        )}
                        <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                          {chat.title}
                        </span>
                        <time
                          className="shrink-0 text-xs text-faint-foreground"
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
          <aside className="@3xl:sticky @3xl:top-8 h-fit divide-y divide-border rounded-card bg-card shadow-card">
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
    <section className="p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-foreground">{title}</h2>
        <div className="flex shrink-0 items-center gap-1">
          {badge ? (
            <span className="inline-flex items-center gap-1 rounded-pill bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
              <Lock className="size-3" aria-hidden />
              {badge}
            </span>
          ) : null}
          {!editing ? (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`${value ? "Edit" : "Add"} ${title.toLowerCase()}`}
              onClick={() => {
                setDraft(value ?? "");
                setEditing(true);
              }}
            >
              {value ? <Pencil className="size-3.5" /> : <Plus className="size-4" />}
            </Button>
          ) : null}
        </div>
      </div>

      {editing ? (
        <div className="mt-2 flex flex-col gap-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={placeholder}
            rows={6}
            autoFocus
          />
          <div className="flex justify-end gap-1.5">
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={async () => {
                await onSave(draft.trim() || null);
                setEditing(false);
              }}
            >
              Save
            </Button>
          </div>
        </div>
      ) : value ? (
        <>
          <p
            className={cn(
              "mt-1.5 text-sm leading-relaxed whitespace-pre-line text-secondary-ink",
              !expanded && "line-clamp-3",
            )}
          >
            {value}
          </p>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="mt-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            {expanded ? "Show less" : "Show more"}
          </button>
        </>
      ) : (
        <p className="mt-1 text-sm text-pretty text-muted-foreground">{hint}</p>
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
    <section className="p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-foreground">Context</h2>
        {/* A single `+` opening a menu, matching the other sections' affordance
            — two text buttons made this header the loudest thing in the rail. */}
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="Add context"
            render={<Button variant="ghost" size="icon-sm" />}
          >
            <Plus className="size-4" />
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

      {resources.length === 0 ? (
        <button
          type="button"
          onClick={() => setAdding("document")}
          className="mt-2 flex w-full flex-col items-center gap-2 rounded-md bg-muted px-4 py-7 text-center transition-colors hover:bg-accent"
        >
          <span className="flex items-end gap-1" aria-hidden>
            <FileText className="size-5 text-faint-foreground" />
            <FileText className="size-6 text-muted-foreground" />
            <FileText className="size-5 text-faint-foreground" />
          </span>
          <span className="text-sm text-pretty text-muted-foreground">
            Attach documents or notes for this project to always have to hand.
          </span>
        </button>
      ) : (
        <ul role="list" className="mt-2 flex flex-col gap-0.5">
          {resources.map((resource) => (
            <li
              key={resource.id}
              className="group flex items-center gap-2 rounded-md px-1.5 py-1.5 hover:bg-accent"
            >
              {resource.kind === "document" ? (
                <FileText className="size-3.5 shrink-0 text-faint-foreground" />
              ) : (
                <StickyNote className="size-3.5 shrink-0 text-faint-foreground" />
              )}
              <span className="min-w-0 flex-1 truncate text-sm">{resource.title}</span>
              <button
                type="button"
                onClick={() => void remove(resource.id)}
                aria-label={`Remove ${resource.title}`}
                className="shrink-0 rounded-pill p-0.5 text-faint-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:text-foreground"
              >
                <Trash2 className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {resources.length > 0 ? (
        <p className="mt-2 text-xs leading-relaxed text-faint-foreground">
          Documents stay live — the assistant reads the current version.
        </p>
      ) : null}

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
