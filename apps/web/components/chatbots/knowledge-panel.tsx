"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  BookOpen,
  ChevronDown,
  FileText,
  Globe,
  HelpCircle,
  Plus,
  RefreshCw,
  Trash2,
  Type,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ChatbotKnowledgeKind, ChatbotKnowledgeStatus } from "@/lib/db/types";
import { NativeSelect } from "@/components/ui/native-select";
import { EmptyState } from "@/components/ui/empty-state";
import {
  addKnowledgeSource,
  deleteKnowledgeSource,
  updateKnowledgeSource,
} from "./actions";

export type KnowledgeSourceRow = {
  id: string;
  kind: ChatbotKnowledgeKind;
  title: string;
  content: string | null;
  question: string | null;
  document_id: string | null;
  url: string | null;
  status: ChatbotKnowledgeStatus;
  error: string | null;
  char_count: number;
  last_trained_at: string | null;
  created_at: string;
};

export type DocumentOption = { id: string; title: string };

const KIND_ICONS = {
  text: Type,
  qa: HelpCircle,
  document: FileText,
  url: Globe,
} as const;

/** Source-type entry points, surfaced directly in the "Add source" menu so
 *  the document path isn't buried inside a <NativeSelect>. */
const SOURCE_KINDS: {
  kind: ChatbotKnowledgeKind;
  label: string;
  hint: string;
}[] = [
  { kind: "text", label: "Text", hint: "Paste a menu, policy, or FAQ" },
  { kind: "qa", label: "Q&A pair", hint: "An exact answer to one question" },
  { kind: "document", label: "Workspace document", hint: "Link a doc from this property" },
  { kind: "url", label: "Web page", hint: "Fetch a public URL" },
];

/**
 * Knowledge tab — what the bot knows. Sources are added untrained
 * (`pending`); Train chunks them into the retrieval table. The status
 * badges keep the "you edited but didn't retrain" state honest.
 */
export function KnowledgePanel({
  propertyId,
  chatbotId,
  sources,
  documents = [],
  lastTrainedAt,
}: {
  propertyId: string;
  chatbotId: string;
  sources: KnowledgeSourceRow[];
  documents?: DocumentOption[];
  lastTrainedAt: string | null;
}) {
  const router = useRouter();
  const [addKind, setAddKind] = useState<ChatbotKnowledgeKind | null>(null);
  const [training, startTraining] = useTransition();

  const pendingCount = sources.filter((s) => s.status === "pending").length;
  const totalChars = sources.reduce((sum, s) => sum + s.char_count, 0);

  function train() {
    startTraining(async () => {
      const res = await fetch(
        `/api/properties/${propertyId}/chatbots/${chatbotId}/train`,
        { method: "POST" },
      );
      if (!res.ok) {
        toast.error("Training failed — try again");
        return;
      }
      const result = (await res.json()) as {
        trained: number;
        failed: number;
        totalChunks: number;
      };
      if (result.failed > 0) {
        toast.warning(
          `Trained ${result.trained} source${result.trained === 1 ? "" : "s"}, ${result.failed} failed — check the source rows`,
        );
      } else {
        toast.success(
          `Trained ${result.trained} source${result.trained === 1 ? "" : "s"} (${result.totalChunks} chunks)`,
        );
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">Knowledge base</p>
          <p className="text-xs text-muted-foreground">
            Menus, policies, hours, FAQs — what the bot answers from.
            {totalChars > 0
              ? ` ${Math.round(totalChars / 1000)}k characters across ${sources.length} source${sources.length === 1 ? "" : "s"}.`
              : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
              <Plus data-slot="icon" />
              Add source
              <ChevronDown data-slot="icon" className="text-muted-foreground" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              {SOURCE_KINDS.map(({ kind, label, hint }) => {
                const Icon = KIND_ICONS[kind];
                const noDocs = kind === "document" && documents.length === 0;
                return (
                  <DropdownMenuItem
                    key={kind}
                    disabled={noDocs}
                    onClick={() => setAddKind(kind)}
                    className="items-start gap-2.5 py-2"
                  >
                    <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <span className="flex flex-col gap-0.5">
                      <span className="text-sm">{label}</span>
                      <span className="text-xs text-muted-foreground">
                        {noDocs ? "No documents in this workspace yet" : hint}
                      </span>
                    </span>
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            size="sm"
            onClick={train}
            disabled={training || sources.length === 0}
          >
            <RefreshCw data-slot="icon" className={training ? "animate-spin" : undefined} />
            {training ? "Training…" : pendingCount > 0 ? `Train (${pendingCount} new)` : "Retrain"}
          </Button>
        </div>
      </div>

      {sources.length === 0 ? (
        <EmptyState icon={BookOpen} title="Nothing trained yet">
          Paste your menu, link a policy doc, or add Q&amp;A pairs — then hit
          Train and test a question in the console.
        </EmptyState>
      ) : (
        <ul className="divide-y divide-border">
          {sources.map((source) => (
            <SourceRow key={source.id} source={source} />
          ))}
        </ul>
      )}

      {lastTrainedAt ? (
        <p className="text-xs text-muted-foreground">
          Last trained{" "}
          {new Date(lastTrainedAt).toLocaleString(undefined, {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })}
        </p>
      ) : null}

      <AddSourceDialog
        propertyId={propertyId}
        chatbotId={chatbotId}
        documents={documents}
        initialKind={addKind}
        onClose={() => setAddKind(null)}
      />
    </div>
  );
}

function SourceRow({ source }: { source: KnowledgeSourceRow }) {
  const router = useRouter();
  const [deleting, startDelete] = useTransition();
  const [open, setOpen] = useState(false);
  const Icon = KIND_ICONS[source.kind];

  function remove(e: React.MouseEvent) {
    e.stopPropagation();
    startDelete(async () => {
      const result = await deleteKnowledgeSource(source.id);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="min-w-0 flex-1 rounded-md text-left transition-colors hover:opacity-80 focus:outline-none focus-visible:shadow-focus"
      >
        <p className="truncate text-sm">{source.title}</p>
        <p className="truncate text-xs text-muted-foreground">
          {source.kind === "qa"
            ? source.question
            : source.kind === "url"
              ? source.url
              : `${Math.max(1, Math.round(source.char_count / 1000))}k characters`}
          {source.error ? ` — ${source.error}` : ""}
        </p>
      </button>
      {source.status === "trained" ? (
        <StatusBadge tone="success">Trained</StatusBadge>
      ) : source.status === "failed" ? (
        <StatusBadge tone="danger">Failed</StatusBadge>
      ) : (
        <Badge variant="secondary">Not trained</Badge>
      )}
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Delete source"
        onClick={remove}
        disabled={deleting}
      >
        <Trash2 className="size-3.5" />
      </Button>
      <SourceDetailDialog source={source} open={open} onOpenChange={setOpen} />
    </li>
  );
}

/**
 * Preview + edit a single source. text/qa are editable (saving resets the
 * source to `pending` so the row's badge nudges a retrain); document/url are
 * read-only snapshots — their content is re-fetched at train time, so we show
 * the last trained snapshot and point the user at the underlying doc/URL.
 */
function SourceDetailDialog({
  source,
  open,
  onOpenChange,
}: {
  source: KnowledgeSourceRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const editable = source.kind === "text" || source.kind === "qa";
  const [title, setTitle] = useState(source.title);
  const [content, setContent] = useState(source.content ?? "");
  const [question, setQuestion] = useState(source.question ?? "");
  const [pending, startTransition] = useTransition();

  // Reset the form to the latest source whenever the dialog (re)opens.
  function handleOpenChange(next: boolean) {
    if (next) {
      setTitle(source.title);
      setContent(source.content ?? "");
      setQuestion(source.question ?? "");
    }
    onOpenChange(next);
  }

  function save(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await updateKnowledgeSource({
        sourceId: source.id,
        title,
        content,
        question: source.kind === "qa" ? question : undefined,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      onOpenChange(false);
      toast.success("Source updated — retrain to apply the changes");
      router.refresh();
    });
  }

  const dirty =
    title !== source.title ||
    content !== (source.content ?? "") ||
    (source.kind === "qa" && question !== (source.question ?? ""));
  const valid =
    title.trim().length > 0 &&
    content.trim().length > 0 &&
    (source.kind !== "qa" || question.trim().length > 0);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editable ? "Edit source" : "Source preview"}</DialogTitle>
          <DialogDescription>
            {editable
              ? "Saving sets this source back to “Not trained” — retrain to apply it."
              : source.kind === "document"
                ? "Linked document — edit the doc itself, then retrain to refresh this snapshot."
                : "Fetched web page — the content is re-fetched on each retrain."}
          </DialogDescription>
        </DialogHeader>

        {editable ? (
          <form onSubmit={save} className="space-y-4">
            {source.kind === "qa" ? (
              <div className="space-y-2">
                <Label htmlFor="edit-question">Question</Label>
                <Input
                  id="edit-question"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                />
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="edit-title">Title</Label>
                <Input
                  id="edit-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="edit-content">
                {source.kind === "qa" ? "Exact answer" : "Content"}
              </Label>
              <Textarea
                id="edit-content"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={source.kind === "qa" ? 4 : 10}
              />
              <p className="text-xs text-muted-foreground">
                {content.trim().length} characters
              </p>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={pending || !valid || !dirty}>
                {pending ? "Saving…" : "Save changes"}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1">
              <Label>Title</Label>
              <p className="text-sm">{source.title}</p>
            </div>
            {source.url ? (
              <div className="space-y-1">
                <Label>Source URL</Label>
                <a
                  href={source.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block truncate text-sm text-primary underline-offset-2 hover:underline"
                >
                  {source.url}
                </a>
              </div>
            ) : null}
            <div className="space-y-1">
              <Label>
                {source.last_trained_at ? "Last trained snapshot" : "Snapshot"}
              </Label>
              {source.content ? (
                <div className="max-h-72 overflow-y-auto whitespace-pre-line rounded-md bg-muted p-3 text-sm">
                  {source.content}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No snapshot yet — retrain to fetch the content.
                </p>
              )}
            </div>
            <DialogFooter>
              <Button type="button" onClick={() => onOpenChange(false)}>
                Close
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function AddSourceDialog({
  propertyId,
  chatbotId,
  documents,
  initialKind,
  onClose,
}: {
  propertyId: string;
  chatbotId: string;
  documents: DocumentOption[];
  initialKind: ChatbotKnowledgeKind | null;
  onClose: () => void;
}) {
  const router = useRouter();
  // The dialog opens seeded to the menu entry the user chose (`initialKind`);
  // the in-dialog Type select can override it without losing that seed.
  const [kindOverride, setKindOverride] = useState<ChatbotKnowledgeKind | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [question, setQuestion] = useState("");
  const [documentId, setDocumentId] = useState("");
  const [url, setUrl] = useState("");
  const [pending, startTransition] = useTransition();

  const open = initialKind !== null;
  const kind = kindOverride ?? initialKind ?? "text";

  function resetFields() {
    setKindOverride(null);
    setTitle("");
    setContent("");
    setQuestion("");
    setDocumentId("");
    setUrl("");
  }

  function onOpenChange(next: boolean) {
    if (!next) {
      resetFields();
      onClose();
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const docTitle = documents.find((d) => d.id === documentId)?.title;
      const result = await addKnowledgeSource({
        chatbotId,
        propertyId,
        kind,
        title:
          title.trim() ||
          (kind === "qa"
            ? question.trim().slice(0, 80)
            : kind === "document"
              ? (docTitle ?? "Document")
              : kind === "url"
                ? url
                : "Untitled"),
        content: kind === "text" || kind === "qa" ? content : undefined,
        question: kind === "qa" ? question : undefined,
        documentId: kind === "document" ? documentId : undefined,
        url: kind === "url" ? url : undefined,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      onOpenChange(false);
      toast.success("Source added — train to make it searchable");
      router.refresh();
    });
  }

  const valid =
    kind === "text"
      ? content.trim().length > 0
      : kind === "qa"
        ? question.trim().length > 0 && content.trim().length > 0
        : kind === "document"
          ? documentId.length > 0
          : url.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a knowledge source</DialogTitle>
          <DialogDescription>
            The bot answers guest questions from these sources after training.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="source-kind">Type</Label>
            <NativeSelect
              id="source-kind"
              value={kind}
              onChange={(e) => setKindOverride(e.target.value as ChatbotKnowledgeKind)}
            >
              <option value="text">Text — paste a menu, policy, FAQ</option>
              <option value="qa">Q&amp;A pair — exact answer to one question</option>
              <option value="document">Document — link a doc from this workspace</option>
              <option value="url">Web page — fetch a public URL</option>
            </NativeSelect>
          </div>

          {kind !== "qa" ? (
            <div className="space-y-2">
              <Label htmlFor="source-title">Title</Label>
              <Input
                id="source-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={
                  kind === "text" ? "Breakfast menu" : kind === "url" ? "Hotel website FAQ" : "Optional"
                }
              />
            </div>
          ) : null}

          {kind === "text" ? (
            <div className="space-y-2">
              <Label htmlFor="source-content">Content</Label>
              <Textarea
                id="source-content"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={8}
                placeholder={"Continental breakfast — $18\nServed 6:30–10:30 daily in the lobby restaurant…"}
              />
            </div>
          ) : null}

          {kind === "qa" ? (
            <>
              <div className="space-y-2">
                <Label htmlFor="source-question">Question</Label>
                <Input
                  id="source-question"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="What time is check-out?"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="source-answer">Exact answer</Label>
                <Textarea
                  id="source-answer"
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  rows={3}
                  placeholder="Check-out is at 11am. Late check-out until 1pm is available for $30 — just ask!"
                />
              </div>
            </>
          ) : null}

          {kind === "document" ? (
            <div className="space-y-2">
              <Label htmlFor="source-document">Document</Label>
              <NativeSelect
                id="source-document"
                value={documentId}
                onChange={(e) => setDocumentId(e.target.value)}
              >
                <option value="">Pick a document…</option>
                {documents.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.title}
                  </option>
                ))}
              </NativeSelect>
              <p className="text-xs text-muted-foreground">
                A snapshot is taken at train time — retrain after editing the doc.
              </p>
            </div>
          ) : null}

          {kind === "url" ? (
            <div className="space-y-2">
              <Label htmlFor="source-url">URL</Label>
              <Input
                id="source-url"
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://yourhotel.com/faq"
              />
            </div>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !valid}>
              {pending ? "Adding…" : "Add source"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
