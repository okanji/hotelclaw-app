"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ClipboardList, Link2, MessageSquareShare, Pencil } from "lucide-react";
import { arrayMove } from "@dnd-kit/sortable";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FormRenderer } from "./form-renderer";
import { FormBuilder } from "./form-builder";
import { FormSettingsPanel } from "./form-settings-panel";
import { ResponsesTab, responsesQueryOptions } from "./form-responses";
import { ShareFormDialog } from "./share-form-dialog";
import { FormStatusBadge } from "./status-badge";
import { SaveStatus, useFormAutosave } from "./form-autosave";
import { FORM_BACKGROUND_CLASSES } from "./backgrounds";
import { updateForm } from "./actions";
import type { BuilderShared, FieldPreset } from "./form-builder-extras";
import {
  FIELD_TYPE_META,
  newFieldId,
  parseFormSchema,
  type FormField,
  type FormSchema,
  type FormSettings,
} from "@/lib/forms/schema";
import {
  duplicateFieldIn,
  insertFieldAt,
  persistableSchema,
  removeFieldFrom,
} from "@/lib/forms/builder";
import type { FormStatus } from "@/lib/db/types";

export type FormRow = {
  id: string;
  property_id: string;
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
 * Form editor page (studio builder port, 2026-10-25). Linear's compact page
 * header (breadcrumb + save status + share / link / publish), then Build |
 * Responses. The page owns the working copy of everything editable — title,
 * description, icon, schema, column settings — and ONE autosave loop
 * (`useFormAutosave`) writes it through `updateForm`; there is no Save
 * button. `canEdit` mirrors the RLS update policy (creator or
 * owner/manager); without it the page shows a read-only Preview + Responses.
 */
export function FormDetail({
  propertyId,
  form,
  canEdit,
}: {
  propertyId: string;
  form: FormRow;
  canEdit: boolean;
}) {
  const [tab, setTab] = useState<"build" | "responses">("build");
  const [title, setTitle] = useState(form.title);
  const [description, setDescription] = useState(form.description ?? "");
  const [icon, setIcon] = useState(form.icon ?? "");
  const [status, setStatus] = useState<FormStatus>(form.status);
  const [allowMultiple, setAllowMultiple] = useState(form.allow_multiple);
  const [anonymous, setAnonymous] = useState(form.anonymous);
  const [schema, setSchema] = useState<FormSchema>(() => parseFormSchema(form.schema));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [statusBusy, startStatus] = useTransition();

  const autosave = useFormAutosave(form.id);
  const { queue, hold } = autosave;

  // Schema edits live in React state; tell autosave directly, debounced like
  // typing. Compared against the last copy handed to autosave (not a
  // first-run flag — React's dev double-invoke would re-save the initial
  // schema), so selecting a card or re-rendering never writes.
  const lastQueued = useRef<string | null>(null);
  useEffect(() => {
    const result = persistableSchema(schema);
    if (!result.ok) {
      hold(result.reason);
      return;
    }
    const json = JSON.stringify(result.schema);
    if (lastQueued.current === null) {
      lastQueued.current = json; // the loaded form — already saved
      return;
    }
    if (json === lastQueued.current) return;
    lastQueued.current = json;
    queue({ schema: result.schema }, 1000);
  }, [schema, queue, hold]);

  const { data: responsesData } = useQuery(responsesQueryOptions(propertyId, form.id));
  const responseCount = responsesData?.responses.length;

  /* ----------------------------- field edits ----------------------------- */

  function patchField(id: string, patch: Partial<FormField>) {
    setSchema((prev) => ({
      ...prev,
      fields: prev.fields.map((f) => (f.id === id ? { ...f, ...patch } : f)),
    }));
  }

  function insertField(index: number, preset: FieldPreset) {
    const isChoice = preset.type === "select" || preset.type === "multi_select";
    const field: FormField = {
      ...preset,
      id: newFieldId(),
      label: preset.label ?? FIELD_TYPE_META[preset.type].label,
      ...(preset.options
        ? { options: preset.options.map((o) => ({ ...o })) }
        : isChoice && !preset.source
          ? {
              options: [
                { id: newFieldId(), label: "Option 1" },
                { id: newFieldId(), label: "Option 2" },
              ],
            }
          : {}),
    };
    setSchema((prev) => ({ ...prev, fields: insertFieldAt(prev.fields, index, field) }));
    setSelectedId(field.id);
  }

  function duplicateField(id: string) {
    const { fields, copyId } = duplicateFieldIn(schema.fields, id);
    setSchema((prev) => ({ ...prev, fields }));
    if (copyId) setSelectedId(copyId);
  }

  function removeField(id: string) {
    setSchema((prev) => ({ ...prev, fields: removeFieldFrom(prev.fields, id) }));
    if (selectedId === id) setSelectedId(null);
  }

  function reorder(activeId: string, overId: string) {
    setSchema((prev) => {
      const from = prev.fields.findIndex((f) => f.id === activeId);
      const to = prev.fields.findIndex((f) => f.id === overId);
      if (from < 0 || to < 0) return prev;
      return { ...prev, fields: arrayMove(prev.fields, from, to) };
    });
  }

  function patchSettings(patch: Partial<FormSettings>) {
    setSchema((prev) => {
      const settings = { ...(prev.settings ?? {}), ...patch };
      // Drop empty keys so an untouched form keeps a clean schema.
      for (const key of Object.keys(settings) as (keyof FormSettings)[]) {
        if (settings[key] === undefined || settings[key] === "") delete settings[key];
      }
      return { ...prev, settings: Object.keys(settings).length > 0 ? settings : undefined };
    });
  }

  const shared: BuilderShared = {
    propertyId,
    formId: form.id,
    canEdit,
    schema,
    selectedId,
    setSelectedId,
    patchField,
    insertField,
    duplicateField,
    removeField,
    reorder,
    applySchema: setSchema,
  };

  /* ---------------------------- column edits ----------------------------- */

  function changeTitle(next: string) {
    setTitle(next);
    if (next.trim()) queue({ title: next.trim() });
    else hold("The form needs a name before it can save");
  }

  function changeDescription(next: string) {
    setDescription(next);
    queue({ description: next.trim() || null });
  }

  function changeIcon(next: string) {
    setIcon(next);
    queue({ icon: next.trim() || null });
  }

  function toggleColumn(key: "allow_multiple" | "anonymous", next: boolean) {
    (key === "allow_multiple" ? setAllowMultiple : setAnonymous)(next);
    queue({ [key]: next }, 400);
  }

  function changeStatus(next: FormStatus) {
    startStatus(async () => {
      const result = await updateForm({ formId: form.id, patch: { status: next } });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setStatus(next);
      toast.success(
        next === "published"
          ? "Form published"
          : next === "closed"
            ? "Form closed"
            : "Form moved back to draft",
      );
    });
  }

  function copyFillLink() {
    const url = `${window.location.origin}/p/${propertyId}/forms/${form.id}/fill`;
    void navigator.clipboard.writeText(url).then(() => toast.success("Fill link copied"));
  }

  const meta = { title: title.trim(), description: description.trim() || null, icon: icon.trim() || null };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        breadcrumbs={[
          { label: "Forms", href: `/p/${propertyId}/forms`, icon: <ClipboardList /> },
          { label: title.trim() || "Untitled form" },
        ]}
        meta={
          canEdit ? (
            <SaveStatus
              state={autosave.state}
              message={autosave.message}
              onRetry={autosave.flush}
            />
          ) : undefined
        }
        actions={
          <div className="flex items-center gap-1.5">
            <FormStatusBadge status={status} />
            <Button variant="ghost" size="sm" onClick={copyFillLink}>
              <Link2 data-slot="icon" />
              <span className="hidden sm:inline">Copy link</span>
            </Button>
            {status === "published" ? (
              <Button variant="ghost" size="sm" onClick={() => setSharing(true)}>
                <MessageSquareShare data-slot="icon" />
                <span className="hidden sm:inline">Share</span>
              </Button>
            ) : null}
            {canEdit && status !== "published" ? (
              <Button size="sm" onClick={() => changeStatus("published")} disabled={statusBusy}>
                Publish
              </Button>
            ) : null}
          </div>
        }
      />

      <Tabs
        value={tab}
        onValueChange={(t) => setTab(t as typeof tab)}
        className="min-h-0 flex-1 gap-0"
      >
        <div className="px-(--page-gutter) pb-2">
          <TabsList>
            <TabsTrigger value="build">{canEdit ? "Build" : "Preview"}</TabsTrigger>
            <TabsTrigger value="responses">
              Responses
              {responseCount !== undefined ? (
                <span className="text-xs text-faint-foreground tabular-nums">{responseCount}</span>
              ) : null}
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="build" className="min-h-0 flex-1 overflow-y-auto">
          <div className="w-full max-w-6xl px-(--page-gutter) pt-4 pb-16">
            {canEdit ? (
              <FormBuilder
                shared={shared}
                meta={meta}
                title={
                  <TitleBlock
                    title={title}
                    description={description}
                    icon={icon}
                    onTitle={changeTitle}
                    onDescription={changeDescription}
                  />
                }
                settings={
                  <FormSettingsPanel
                    propertyId={propertyId}
                    formId={form.id}
                    formTitle={title}
                    status={status}
                    statusBusy={statusBusy}
                    onStatusChange={changeStatus}
                    icon={icon}
                    onIconChange={changeIcon}
                    allowMultiple={allowMultiple}
                    anonymous={anonymous}
                    onToggle={toggleColumn}
                    settings={schema.settings ?? {}}
                    onPatchSettings={patchSettings}
                  />
                }
              />
            ) : (
              <ReadOnlyPreview schema={schema} meta={meta} propertyId={propertyId} />
            )}
          </div>
        </TabsContent>
        <TabsContent value="responses" className="min-h-0 flex-1 overflow-y-auto">
          <div className="w-full max-w-6xl px-(--page-gutter) pt-4 pb-16">
            <ResponsesTab
              propertyId={propertyId}
              formId={form.id}
              status={status}
              schema={schema}
            />
          </div>
        </TabsContent>
      </Tabs>

      {sharing ? (
        <ShareFormDialog
          propertyId={propertyId}
          formId={form.id}
          formTitle={title}
          open
          onOpenChange={(o) => {
            if (!o) setSharing(false);
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * The studio title line: the form's name as an editable heading with a
 * pencil to rename (the pencil fades while the input has focus), and the
 * respondent-facing description under it. Both autosave.
 */
function TitleBlock({
  title,
  description,
  icon,
  onTitle,
  onDescription,
}: {
  title: string;
  description: string;
  icon: string;
  onTitle: (title: string) => void;
  onDescription: (description: string) => void;
}) {
  return (
    <header className="grid gap-1.5">
      <div className="flex min-w-0 items-center gap-1">
        {icon ? <span className="mr-1 text-2xl">{icon}</span> : null}
        <input
          id="form-name"
          value={title}
          onChange={(e) => onTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          placeholder="Name this form"
          autoComplete="off"
          aria-label="Form name"
          className="peer -ml-2 field-sizing-content max-w-full min-w-[6ch] rounded-md bg-transparent px-2 py-1 text-2xl font-semibold text-foreground outline-none transition-shadow placeholder:text-faint-foreground hover:shadow-ring focus:bg-card focus:shadow-focus"
        />
        <label
          htmlFor="form-name"
          title="Rename"
          className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-faint-foreground transition-opacity hover:bg-accent hover:text-foreground peer-focus:opacity-0"
        >
          <Pencil className="size-4" aria-hidden />
          <span className="sr-only">Rename the form</span>
        </label>
      </div>
      <textarea
        value={description}
        onChange={(e) => onDescription(e.target.value)}
        rows={description.length > 120 ? 3 : 1}
        placeholder="Add a description for respondents…"
        aria-label="Form description"
        className={cn(
          "-ml-2 w-full resize-none rounded-md bg-transparent px-2 py-1 text-sm leading-relaxed text-muted-foreground outline-none transition-shadow",
          "placeholder:text-faint-foreground hover:shadow-ring focus:bg-card focus:shadow-focus",
        )}
      />
    </header>
  );
}

/** For viewers who can't edit: the live fill experience, simulated. */
function ReadOnlyPreview({
  schema,
  meta,
  propertyId,
}: {
  schema: FormSchema;
  meta: { title: string; description: string | null; icon: string | null };
  propertyId: string;
}) {
  const background = schema.settings?.background ?? "default";
  return (
    <div className={cn("rounded-card px-6 py-10 sm:px-10", FORM_BACKGROUND_CLASSES[background])}>
      <div className="mx-auto w-full max-w-2xl">
        <header className="mb-8 flex flex-col items-start gap-3">
          {meta.icon ? <span className="text-3xl">{meta.icon}</span> : null}
          <h2 className="text-2xl font-semibold text-balance">{meta.title || "Untitled form"}</h2>
          {meta.description ? (
            <p className="max-w-prose text-base text-muted-foreground">{meta.description}</p>
          ) : null}
        </header>
        {schema.fields.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            This form has no questions yet.
          </p>
        ) : (
          <FormRenderer
            schema={schema}
            propertyId={propertyId}
            onSubmit={async () => {
              toast.success("Preview only — nothing was submitted");
              return { ok: true };
            }}
          />
        )}
      </div>
    </div>
  );
}
