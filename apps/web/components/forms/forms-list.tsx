"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowRight,
  ClipboardList,
  Copy,
  LayoutTemplate,
  MessageSquareShare,
  MoreHorizontal,
  PenLine,
  Pin,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { AutomationsButton } from "@/components/workflows/automations-button";
import { PageHeader } from "@/components/shell/page-header";
import { EmptyState } from "@/components/ui/empty-state";
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
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TintIcon } from "@/components/ui/tint-card";
import { FormStatusBadge } from "./status-badge";
import { GenerateFormDialog } from "./generate-form-dialog";
import { ShareFormDialog } from "./share-form-dialog";
import { PinFormDialog } from "./pin-form-dialog";
import { createForm, deleteForm } from "./actions";
import { inputFields, parseFormSchema } from "@/lib/forms/schema";
import { STARTER_FORMS, type StarterForm } from "@/lib/forms/templates";
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

/**
 * Forms library — the studio platform's library layout under Linear's
 * compact page header: one card per form that says what it is in plain
 * words (who answers, how often, whether it needs a signature, its status)
 * with an "Edit form" action, plus starter forms so a property has a waiver
 * and a maintenance request on day one. Server actions handle writes;
 * `router.refresh()` re-runs the server fetch so counts stay authoritative.
 */
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
  const params = useSearchParams();
  const [newOpen, setNewOpen] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [deleting, setDeleting] = useState<FormListItem | null>(null);
  const [sharing, setSharing] = useState<FormListItem | null>(null);
  const [pinning, setPinning] = useState<FormListItem | null>(null);
  const [creatingStarter, startStarter] = useTransition();
  const base = `/p/${propertyId}/forms`;

  // The Forms section sidebar deep-links the create flows (`?new=1` /
  // `?ai=1`). React to the param on every navigation (not just mount — the
  // component stays mounted when only the query string changes), then strip
  // it so closing the dialog leaves a clean URL and the link works again.
  const wantsNew = params.get("new") === "1";
  const wantsAi = params.get("ai") === "1";
  const paramsKey = params.toString();
  const [seenParams, setSeenParams] = useState<string | null>(null);
  if (paramsKey !== seenParams) {
    setSeenParams(paramsKey);
    if (wantsNew) setNewOpen(true);
    if (wantsAi) setGenerateOpen(true);
  }
  useEffect(() => {
    if (wantsNew || wantsAi) window.history.replaceState(null, "", base);
  }, [wantsNew, wantsAi, base]);

  function createStarter(starter: StarterForm) {
    startStarter(async () => {
      const result = await createForm({
        propertyId,
        title: starter.title,
        description: starter.description,
        schema: starter.schema,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(`${starter.title} added — edit the wording, then publish`);
      router.push(`${base}/${result.formId}`);
    });
  }

  const published = forms.filter((f) => f.status === "published").length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="Forms"
        icon={<ClipboardList />}
        meta={
          forms.length > 0 ? (
            <span className="tabular-nums">
              {forms.length} {forms.length === 1 ? "form" : "forms"} · {published} published
            </span>
          ) : null
        }
        actions={
          <div className="flex items-center gap-1.5">
            <AutomationsButton propertyId={propertyId} feature="forms" />
            <StarterMenu onPick={createStarter} disabled={creatingStarter} />
            <Button variant="ghost" size="sm" onClick={() => setGenerateOpen(true)}>
              <Sparkles data-slot="icon" />
              <span className="hidden sm:inline">Draft with AI</span>
            </Button>
            <Button size="sm" onClick={() => setNewOpen(true)}>
              <Plus data-slot="icon" />
              New form
            </Button>
          </div>
        }
      />

      <div className="@container flex-1 overflow-y-auto px-(--page-gutter) pt-2 pb-12">
        {forms.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title="No forms yet"
            className="mt-8"
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <StarterMenu
                  onPick={createStarter}
                  disabled={creatingStarter}
                  label="Start from a template"
                  variant="outline"
                />
                <Button variant="outline" size="sm" onClick={() => setGenerateOpen(true)}>
                  <Sparkles data-slot="icon" />
                  Draft with AI
                </Button>
                <Button size="sm" onClick={() => setNewOpen(true)}>
                  <Plus data-slot="icon" />
                  New form
                </Button>
              </div>
            }
          >
            Start from a waiver, maintenance request or incident report and edit
            the wording, describe what you need and let AI draft it, or build your
            own.
          </EmptyState>
        ) : (
          <div className="grid grid-cols-1 gap-4 @2xl:grid-cols-2 @5xl:grid-cols-3">
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
      </div>

      <NewFormDialog propertyId={propertyId} open={newOpen} onOpenChange={setNewOpen} />
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

function StarterMenu({
  onPick,
  disabled,
  label = "Templates",
  variant = "ghost",
}: {
  onPick: (starter: StarterForm) => void;
  disabled?: boolean;
  label?: string;
  variant?: "ghost" | "outline";
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant={variant} size="sm" disabled={disabled} />}
      >
        <LayoutTemplate data-slot="icon" />
        <span className={variant === "ghost" ? "hidden sm:inline" : undefined}>{label}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
            Starter forms — added as drafts
          </DropdownMenuLabel>
          {STARTER_FORMS.map((starter) => (
            <DropdownMenuItem
              key={starter.key}
              onClick={() => onPick(starter)}
              className="items-start"
            >
              <span aria-hidden className="text-base leading-5">
                {starter.icon}
              </span>
              <span className="grid gap-0.5">
                <span className="text-sm">{starter.title}</span>
                <span className="text-xs text-muted-foreground">{starter.description}</span>
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** One plain-words row on a library card. */
function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate text-right">{value}</dd>
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
  const schema = parseFormSchema(form.schema);
  const questions = inputFields(schema).length;
  const signs = schema.fields.some((f) => f.type === "signature");

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
    <article className="group flex flex-col gap-4 rounded-card bg-card p-5 shadow-card">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-3">
          <TintIcon tone="honey">{form.icon || <ClipboardList />}</TintIcon>
          <div className="min-w-0">
            <Link
              href={href}
              className="block truncate text-base font-medium hover:underline hover:underline-offset-2"
            >
              {form.title}
            </Link>
            <p className="line-clamp-2 text-sm text-pretty text-muted-foreground">
              {form.description || "A form you built."}
            </p>
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                className="shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100"
                aria-label="Form actions"
              />
            }
          >
            <MoreHorizontal className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => router.push(href)}>
              <PenLine data-slot="icon" />
              Edit
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

      <dl className="divide-y divide-border border-y border-border">
        <InfoRow label="Status" value={<FormStatusBadge status={form.status} />} />
        <InfoRow
          label="Questions"
          value={questions === 0 ? "None yet" : `${questions}`}
        />
        <InfoRow
          label="Answered"
          value={
            form.anonymous
              ? "Anonymously"
              : form.allow_multiple
                ? "As often as needed"
                : "Once per person"
          }
        />
        <InfoRow label="Signature" value={signs ? "Asked for" : "Not needed"} />
        <InfoRow
          label="Responses"
          value={<span className="tabular-nums">{responseCount}</span>}
        />
      </dl>

      <div className="mt-auto">
        <Button nativeButton={false} variant="outline" size="sm" render={<Link href={href} />}>
          Edit form
          <ArrowRight data-slot="icon" />
        </Button>
      </div>
    </article>
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
