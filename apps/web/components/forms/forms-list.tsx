"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ClipboardList,
  Copy,
  MessageSquareShare,
  MoreHorizontal,
  PenLine,
  Pin,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { SectionHeader } from "@/components/ui/section-header";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TintIcon } from "@/components/ui/tint-card";
import { FormStatusBadge } from "./status-badge";
import { GenerateFormDialog } from "./generate-form-dialog";
import { ShareFormDialog } from "./share-form-dialog";
import { PinFormDialog } from "./pin-form-dialog";
import { createForm, deleteForm } from "./actions";
import type { FormStatus } from "@/lib/db/types";

export type FormListItem = {
  id: string;
  title: string;
  description: string | null;
  icon: string | null;
  schema: unknown;
  status: FormStatus;
  allow_multiple: boolean;
  anonymous: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

/** Forms index — cards for every form in the property, plus create/AI entry
 *  points. Server actions handle writes; `router.refresh()` re-runs the
 *  server fetch so counts and rows stay authoritative. */
export function FormsList({
  propertyId,
  forms,
  responseCounts,
}: {
  propertyId: string;
  forms: FormListItem[];
  responseCounts: Record<string, number>;
}) {
  const router = useRouter();
  const [newOpen, setNewOpen] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [deleting, setDeleting] = useState<FormListItem | null>(null);
  const [sharing, setSharing] = useState<FormListItem | null>(null);
  const [pinning, setPinning] = useState<FormListItem | null>(null);
  const base = `/p/${propertyId}/forms`;

  return (
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col overflow-y-auto px-8 pt-12 pb-16 sm:px-14 sm:pt-16">
      <SectionHeader
        size="page"
        className="flex-wrap gap-y-3"
        title="Forms"
        description="Build intake and feedback forms for the team — maintenance requests, surveys, checklists. Publish one and share the fill link, or let a workflow react to submissions."
        actions={
          <>
            <Button variant="outline" onClick={() => setGenerateOpen(true)}>
              <Sparkles data-slot="icon" />
              Generate with AI
            </Button>
            <Button onClick={() => setNewOpen(true)}>
              <Plus data-slot="icon" />
              New form
            </Button>
          </>
        }
      />

      {/* Masthead and content separate by WHITESPACE. The full-width rule
          that used to sit here read as a seam under a 720px document
          column (notion-spec-v2 §1/§3). */}
      <div className="h-10" />

      {forms.length === 0 ? (
        <EmptyState
          onCreate={() => setNewOpen(true)}
          onGenerate={() => setGenerateOpen(true)}
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {forms.map((form) => (
            <FormCard
              key={form.id}
              form={form}
              href={`${base}/${form.id}`}
              fillHref={`${base}/${form.id}/fill`}
              responseCount={responseCounts[form.id] ?? 0}
              propertyId={propertyId}
              onDelete={() => setDeleting(form)}
              onShare={() => setSharing(form)}
              onPin={() => setPinning(form)}
            />
          ))}
        </div>
      )}

      <NewFormDialog
        propertyId={propertyId}
        open={newOpen}
        onOpenChange={setNewOpen}
      />
      <GenerateFormDialog
        propertyId={propertyId}
        open={generateOpen}
        onOpenChange={setGenerateOpen}
      />
      {sharing ? (
        <ShareFormDialog
          propertyId={propertyId}
          formId={sharing.id}
          formTitle={sharing.title}
          open
          onOpenChange={(o) => {
            if (!o) setSharing(null);
          }}
        />
      ) : null}
      {pinning ? (
        <PinFormDialog
          propertyId={propertyId}
          formId={pinning.id}
          formTitle={pinning.title}
          open
          onOpenChange={(o) => {
            if (!o) setPinning(null);
          }}
        />
      ) : null}
      <DeleteFormDialog
        form={deleting}
        onOpenChange={(o) => {
          if (!o) setDeleting(null);
        }}
        onDeleted={() => {
          setDeleting(null);
          router.refresh();
        }}
      />
    </div>
  );
}

function FormCard({
  form,
  href,
  fillHref,
  responseCount,
  propertyId,
  onDelete,
  onShare,
  onPin,
}: {
  form: FormListItem;
  href: string;
  fillHref: string;
  responseCount: number;
  propertyId: string;
  onDelete: () => void;
  onShare: () => void;
  onPin: () => void;
}) {
  const router = useRouter();
  const [duplicating, startDuplicate] = useTransition();

  function duplicate() {
    startDuplicate(async () => {
      const result = await createForm({
        propertyId,
        title: `${form.title} copy`,
        description: form.description,
        schema: form.schema ?? undefined,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Form duplicated");
      router.push(`/p/${propertyId}/forms/${result.formId}`);
    });
  }

  return (
    <div className="group relative flex flex-col gap-3 rounded-card bg-card p-4 shadow-card transition-colors hover:bg-accent">
      <Link href={href} className="absolute inset-0" aria-label={form.title} />
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-3">
          <TintIcon tone="honey">
            {form.icon || <ClipboardList />}
          </TintIcon>
          <div className="min-w-0">
            <p className="truncate text-base leading-6 font-normal">{form.title}</p>
            {form.description ? (
              <p className="truncate text-sm text-muted-foreground">
                {form.description}
              </p>
            ) : null}
          </div>
        </div>
        <div className="relative z-10 shrink-0">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100"
                  aria-label="Form actions"
                />
              }
            >
              <MoreHorizontal className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => router.push(href)}>
                <PenLine data-slot="icon" />
                Open
              </DropdownMenuItem>
              {form.status === "published" ? (
                <DropdownMenuItem onClick={() => router.push(fillHref)}>
                  <ClipboardList data-slot="icon" />
                  Fill
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem onClick={duplicate} disabled={duplicating}>
                <Copy data-slot="icon" />
                Duplicate
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onShare}>
                <MessageSquareShare data-slot="icon" />
                Share to chat
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onPin}>
                <Pin data-slot="icon" />
                Pin to space
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={onDelete}>
                <Trash2 data-slot="icon" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <FormStatusBadge status={form.status} />
        <span>
          {responseCount} {responseCount === 1 ? "response" : "responses"}
        </span>
        <span>
          {new Date(form.created_at).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
        </span>
      </div>
    </div>
  );
}

function EmptyState({
  onCreate,
  onGenerate,
}: {
  onCreate: () => void;
  onGenerate: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-4 py-16 text-center">
      <ClipboardList className="size-5 text-faint-foreground" aria-hidden />
      <div>
        <p className="text-sm font-medium">No forms yet</p>
        <p className="mt-1 max-w-[36ch] text-sm text-pretty text-muted-foreground">
          Create a form from scratch, or describe what you need and let AI
          draft the fields for you.
        </p>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" onClick={onGenerate}>
          <Sparkles data-slot="icon" />
          Generate with AI
        </Button>
        <Button onClick={onCreate}>
          <Plus data-slot="icon" />
          New form
        </Button>
      </div>
    </div>
  );
}

function NewFormDialog({
  propertyId,
  open,
  onOpenChange,
}: {
  propertyId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [pending, startTransition] = useTransition();

  function create(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await createForm({ propertyId, title });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setTitle("");
      onOpenChange(false);
      router.push(`/p/${propertyId}/forms/${result.formId}`);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New form</DialogTitle>
          <DialogDescription>
            Name it now, add fields in the builder next.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={create} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="new-form-title">Title</Label>
            <Input
              id="new-form-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Maintenance request"
              disabled={pending}
              autoFocus
              required
            />
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
            <Button type="submit" disabled={pending || !title.trim()}>
              {pending ? "Creating…" : "Create form"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteFormDialog({
  form,
  onOpenChange,
  onDeleted,
}: {
  form: FormListItem | null;
  onOpenChange: (open: boolean) => void;
  onDeleted: () => void;
}) {
  const [pending, startTransition] = useTransition();

  function confirm() {
    if (!form) return;
    startTransition(async () => {
      const result = await deleteForm(form.id);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Form deleted");
      onDeleted();
    });
  }

  return (
    <Dialog open={form !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete form?</DialogTitle>
          <DialogDescription>
            &ldquo;{form?.title}&rdquo; and all of its responses will be
            permanently deleted.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={confirm}
            disabled={pending}
          >
            {pending ? "Deleting…" : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
