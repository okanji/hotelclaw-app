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
  Search,
  SearchX,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Gi } from "@/components/gr8r/icon";
import { G8Empty } from "@/components/gr8r/members-shared";
import { AutomationsButton } from "@/components/workflows/automations-button";
import { PageHeader } from "@/components/shell/page-header";
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
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | FormStatus>("all");
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
  const needle = q.trim().toLowerCase();
  const shown = forms.filter(
    (f) =>
      (statusFilter === "all" || f.status === statusFilter) &&
      (!needle ||
        f.title.toLowerCase().includes(needle) ||
        (f.description ?? "").toLowerCase().includes(needle)),
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="Forms"
        icon={<ClipboardList />}
        actions={<AutomationsButton propertyId={propertyId} feature="forms" />}
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="page wide">
          <div className="ph">
            <div>
              <h1>Forms</h1>
              <p>
                {forms.length === 0
                  ? "Waivers, requests and reports your team and guests fill in."
                  : `${forms.length} ${forms.length === 1 ? "form" : "forms"} · ${published} published`}
              </p>
            </div>
            <div className="acts">
              <StarterMenu onPick={createStarter} disabled={creatingStarter} />
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setGenerateOpen(true)}
              >
                <Gi icon={Sparkles} size={14} />
                <span className="hide-m">Draft with AI</span>
              </button>
              <button type="button" className="btn btn-primary" onClick={() => setNewOpen(true)}>
                <Gi icon={Plus} size={14} />
                New form
              </button>
            </div>
          </div>

          {forms.length === 0 ? (
            <G8Empty
              icon={ClipboardList}
              title="No forms yet"
              text="Start from a waiver, maintenance request or incident report and edit the wording, describe what you need and let AI draft it, or build your own."
            >
              <div className="row" style={{ flexWrap: "wrap", justifyContent: "center", gap: 8, marginTop: 4 }}>
                <StarterMenu
                  onPick={createStarter}
                  disabled={creatingStarter}
                  label="Start from a template"
                  variant="outline"
                />
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setGenerateOpen(true)}
                >
                  <Gi icon={Sparkles} size={13} />
                  Draft with AI
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => setNewOpen(true)}
                >
                  <Gi icon={Plus} size={13} />
                  New form
                </button>
              </div>
            </G8Empty>
          ) : (
            <>
              <div className="row" style={{ marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
                <div className="inwrap">
                  <Gi icon={Search} size={13} />
                  <input
                    className="input search-sm"
                    placeholder="Search forms"
                    aria-label="Search forms"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                  />
                </div>
                <select
                  className="select"
                  style={{ height: 26, width: "auto", fontSize: 12 }}
                  aria-label="Filter by status"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as "all" | FormStatus)}
                >
                  <option value="all">All statuses</option>
                  <option value="published">Published</option>
                  <option value="draft">Draft</option>
                  <option value="closed">Closed</option>
                </select>
                {shown.length !== forms.length ? (
                  <span className="faint num" style={{ fontSize: 12 }}>
                    {shown.length} of {forms.length}
                  </span>
                ) : null}
              </div>
              {shown.length === 0 ? (
                <G8Empty
                  sm
                  icon={SearchX}
                  title="No results found"
                  text="No forms match your search."
                >
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      setQ("");
                      setStatusFilter("all");
                    }}
                  >
                    Clear filters
                  </button>
                </G8Empty>
              ) : (
                <div className="pgrid">
                  {shown.map((form) => (
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
            </>
          )}
        </div>
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
        render={
          <button
            type="button"
            className={variant === "ghost" ? "btn btn-ghost" : "btn btn-secondary btn-sm"}
            disabled={disabled}
          />
        }
      >
        <Gi icon={LayoutTemplate} size={variant === "ghost" ? 14 : 13} />
        <span className={variant === "ghost" ? "hide-m" : undefined}>{label}</span>
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

  // gr8r `.pcard`: `.picon` + title + description, the plain-words facts as
  // a `.kv` list, and a `.foot` with the status pill and the response count.
  return (
    // No card-level click: menu items portal but still bubble through the
    // React tree, so a card onClick would navigate on "Delete". The title
    // link and "Edit form" are the ways in.
    <article className="pcard" style={{ cursor: "default" }}>
      <div className="row" style={{ gap: 10, alignItems: "flex-start" }}>
        <span className="picon lg" style={{ "--g8-c": "var(--g8-amber)" } as React.CSSProperties}>
          {form.icon ? (
            <span aria-hidden style={{ fontSize: 17, lineHeight: 1 }}>{form.icon}</span>
          ) : (
            <Gi icon={ClipboardList} size={17} />
          )}
        </span>
        <div className="grow" style={{ minWidth: 0, paddingRight: 24 }}>
          <Link
            href={href}
            className="trunc"
            style={{ display: "block", fontWeight: 600, color: "inherit" }}
          >
            {form.title}
          </Link>
          <div className="desc" style={{ minHeight: 0 }}>
            {form.description || "A form you built."}
          </div>
        </div>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              className="ibtn ibtn-sm more"
              aria-label="Form actions"
            />
          }
        >
          <Gi icon={MoreHorizontal} size={14} />
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

      <dl className="kv">
        <dt>Questions</dt>
        <dd>{questions === 0 ? "None yet" : questions}</dd>
        <dt>Answered</dt>
        <dd>
          {form.anonymous
            ? "Anonymously"
            : form.allow_multiple
              ? "As often as needed"
              : "Once per person"}
        </dd>
        <dt>Signature</dt>
        <dd>{signs ? "Asked for" : "Not needed"}</dd>
      </dl>

      <div className="foot">
        <FormStatusBadge status={form.status} />
        <span className="num">
          {responseCount} {responseCount === 1 ? "response" : "responses"}
        </span>
        <span className="sp" />
        <Link href={href} className="btn btn-ghost btn-sm">
          Edit form
          <Gi icon={ArrowRight} size={13} />
        </Link>
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
