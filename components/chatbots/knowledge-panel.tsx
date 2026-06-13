"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  BookOpen,
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
import type { ChatbotKnowledgeKind, ChatbotKnowledgeStatus } from "@/lib/db/types";
import { addKnowledgeSource, deleteKnowledgeSource } from "./actions";

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

const selectClass =
  "h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring";

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
  const [addOpen, setAddOpen] = useState(false);
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
          <Button variant="outline" size="sm" onClick={() => setAddOpen(true)}>
            <Plus data-slot="icon" />
            Add source
          </Button>
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
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border py-12 text-center">
          <span className="flex size-10 items-center justify-center rounded-full bg-muted">
            <BookOpen className="size-5 text-muted-foreground" />
          </span>
          <div>
            <p className="text-sm font-medium">Nothing trained yet</p>
            <p className="mt-1 max-w-[42ch] text-sm text-muted-foreground">
              Paste your menu, link a policy doc, or add Q&amp;A pairs — then
              hit Train and test a question in the console.
            </p>
          </div>
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
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
        open={addOpen}
        onOpenChange={setAddOpen}
      />
    </div>
  );
}

function SourceRow({ source }: { source: KnowledgeSourceRow }) {
  const router = useRouter();
  const [deleting, startDelete] = useTransition();
  const Icon = KIND_ICONS[source.kind];

  function remove() {
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
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{source.title}</p>
        <p className="truncate text-xs text-muted-foreground">
          {source.kind === "qa"
            ? source.question
            : source.kind === "url"
              ? source.url
              : `${Math.max(1, Math.round(source.char_count / 1000))}k characters`}
          {source.error ? ` — ${source.error}` : ""}
        </p>
      </div>
      {source.status === "trained" ? (
        <Badge className="border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
          Trained
        </Badge>
      ) : source.status === "failed" ? (
        <Badge className="border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400">
          Failed
        </Badge>
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
    </li>
  );
}

function AddSourceDialog({
  propertyId,
  chatbotId,
  documents,
  open,
  onOpenChange,
}: {
  propertyId: string;
  chatbotId: string;
  documents: DocumentOption[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [kind, setKind] = useState<ChatbotKnowledgeKind>("text");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [question, setQuestion] = useState("");
  const [documentId, setDocumentId] = useState("");
  const [url, setUrl] = useState("");
  const [pending, startTransition] = useTransition();

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
      setTitle("");
      setContent("");
      setQuestion("");
      setDocumentId("");
      setUrl("");
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
            <select
              id="source-kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as ChatbotKnowledgeKind)}
              className={selectClass}
            >
              <option value="text">Text — paste a menu, policy, FAQ</option>
              <option value="qa">Q&amp;A pair — exact answer to one question</option>
              <option value="document">Document — link a doc from this workspace</option>
              <option value="url">Web page — fetch a public URL</option>
            </select>
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
              <select
                id="source-document"
                value={documentId}
                onChange={(e) => setDocumentId(e.target.value)}
                className={selectClass}
              >
                <option value="">Pick a document…</option>
                {documents.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.title}
                  </option>
                ))}
              </select>
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
