"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, FileText, Loader2, Network, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Progress } from "@/components/ui/progress";
import { createClient } from "@/lib/supabase/client";
import {
  propertyMembersQueryOptions,
  tasksQueryOptions,
} from "@/lib/query/section-queries";
import type { CustomFieldRow } from "@/lib/query/custom-field-queries";
import type { CustomFieldValue } from "@/lib/db/types";
import { formatCurrency } from "@/lib/tasks/custom-field-options";
import { coerceFieldValue } from "@/lib/tasks/field-coerce";
import { isDone } from "@/lib/tasks/statuses";
import { AssigneeStack } from "./assignee-stack";
import { AssigneeMenuContent } from "./task-property-menus";
import { taskKey } from "./kanban";
import { removeTaskAttachment } from "./task-detail-actions";

/**
 * Editors for the 0116 field types that need data beyond the field itself:
 * people (members), relation (the task list), files (the task's attachments),
 * progress (sub-issues + checklists). `CustomFieldValueEditor` routes here.
 */

export type FieldEditorContext = { propertyId: string; taskId: string };

const ROW =
  "flex w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-left text-sm transition-colors hover:bg-accent";

/* ── People ─────────────────────────────────────────────────────────────── */

export function PeopleFieldEditor({
  field,
  value,
  ctx,
  disabled,
  onSave,
  align,
  placeholder,
}: {
  field: CustomFieldRow;
  value: CustomFieldValue | null;
  ctx: FieldEditorContext;
  disabled?: boolean;
  onSave: (v: CustomFieldValue | null) => void;
  align: "start" | "end";
  placeholder: string;
}) {
  const { data: members = [] } = useQuery(propertyMembersQueryOptions(ctx.propertyId));
  const ids = Array.isArray(value) ? value : [];
  const infos = useMemo(
    () =>
      Object.fromEntries(
        members.map((m) => [m.id, { name: m.name ?? "Member", avatar: m.avatarUrl ?? undefined }]),
      ),
    [members],
  );
  const single = field.config?.multiple === false;
  const first = ids[0] ? infos[ids[0]]?.name : undefined;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<button type="button" disabled={disabled} className={ROW} />}
      >
        {ids.length > 0 ? (
          <>
            <AssigneeStack ids={ids} infos={infos} size={20} />
            <span className="truncate text-foreground">
              {ids.length === 1 ? first : `${first ?? "Member"} +${ids.length - 1}`}
            </span>
          </>
        ) : (
          <span className="text-muted-foreground">{placeholder}</span>
        )}
      </DropdownMenuTrigger>
      {single ? (
        <AssigneeMenuContent
          align={align}
          members={members}
          onSelect={(id) => onSave(id ? [id] : null)}
        />
      ) : (
        <AssigneeMenuContent
          align={align}
          members={members}
          selectedIds={ids}
          onChange={(next) => onSave(next.length ? next : null)}
        />
      )}
    </DropdownMenu>
  );
}

/* ── Relation ───────────────────────────────────────────────────────────── */

export function RelationFieldEditor({
  field,
  value,
  ctx,
  disabled,
  onSave,
  align,
  placeholder,
}: {
  field: CustomFieldRow;
  value: CustomFieldValue | null;
  ctx: FieldEditorContext;
  disabled?: boolean;
  onSave: (v: CustomFieldValue | null) => void;
  align: "start" | "end";
  placeholder: string;
}) {
  const { data: tasks = [] } = useQuery(tasksQueryOptions(ctx.propertyId));
  const ids = Array.isArray(value) ? value : [];
  const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const target = field.config?.target_list_id ?? null;
  const candidates = useMemo(
    () =>
      tasks.filter(
        (t) => t.id !== ctx.taskId && (!target || t.list_id === target),
      ),
    [tasks, ctx.taskId, target],
  );
  const linked = ids.map((id) => byId.get(id)).filter((t): t is NonNullable<typeof t> => !!t);
  return (
    <Popover>
      <PopoverTrigger render={<button type="button" disabled={disabled} className={ROW} />}>
        {linked.length > 0 ? (
          <span className="flex min-w-0 items-center gap-1 truncate text-foreground">
            <Network className="size-3 shrink-0 text-muted-foreground" />
            <span className="truncate">
              {linked.length === 1 ? linked[0]!.title : `${linked[0]!.title} +${linked.length - 1}`}
            </span>
          </span>
        ) : ids.length > 0 ? (
          <span className="text-muted-foreground">{ids.length} linked</span>
        ) : (
          <span className="text-muted-foreground">{placeholder}</span>
        )}
      </PopoverTrigger>
      <PopoverContent align={align} className="w-72 p-0">
        <Command>
          <CommandInput placeholder="Search tasks…" />
          <CommandList className="max-h-64">
            <CommandEmpty>No tasks.</CommandEmpty>
            {linked.length > 0 ? (
              <CommandGroup heading="Linked">
                {linked.map((t) => (
                  <CommandItem
                    key={t.id}
                    value={`linked ${taskKey(t)} ${t.title}`}
                    onSelect={() => {
                      const next = ids.filter((id) => id !== t.id);
                      onSave(next.length ? next : null);
                    }}
                    className="gap-2"
                  >
                    <span className="w-14 shrink-0 text-xs text-faint-foreground tabular-nums">
                      {taskKey(t)}
                    </span>
                    <span className="flex-1 truncate">{t.title}</span>
                    <X className="size-3 text-muted-foreground" />
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
            <CommandGroup heading="Link a task">
              {candidates
                .filter((t) => !ids.includes(t.id))
                .slice(0, 200)
                .map((t) => (
                  <CommandItem
                    key={t.id}
                    value={`${taskKey(t)} ${t.title}`}
                    onSelect={() => onSave([...ids, t.id])}
                    className="gap-2"
                  >
                    <span className="w-14 shrink-0 text-xs text-faint-foreground tabular-nums">
                      {taskKey(t)}
                    </span>
                    <span className="flex-1 truncate">{t.title}</span>
                  </CommandItem>
                ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/* ── Files ──────────────────────────────────────────────────────────────── */

type FieldFile = { id: string; file_name: string; storage_path: string };

function fieldFilesQueryKey(taskId: string, fieldId: string) {
  return ["task-field-files", taskId, fieldId] as const;
}

export function FilesFieldEditor({
  field,
  value,
  ctx,
  disabled,
  placeholder,
  singleLine,
}: {
  field: CustomFieldRow;
  value: CustomFieldValue | null;
  ctx: FieldEditorContext;
  disabled?: boolean;
  placeholder: string;
  singleLine?: boolean;
}) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const count = Array.isArray(value) ? value.length : 0;
  // The value is the attachment-id list the DB derives; names come from
  // task_attachments (keyed on the value so a new upload refetches).
  const { data: files = [] } = useQuery({
    queryKey: [...fieldFilesQueryKey(ctx.taskId, field.id), count],
    queryFn: async (): Promise<FieldFile[]> => {
      const supabase = createClient();
      const { data } = await supabase
        .from("task_attachments")
        .select("id, file_name, storage_path")
        .eq("task_id", ctx.taskId)
        .eq("field_id", field.id)
        .order("created_at", { ascending: true });
      return (data ?? []) as FieldFile[];
    },
    enabled: count > 0,
    staleTime: 30_000,
  });

  async function refresh() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["task-field-values", ctx.taskId] }),
      qc.invalidateQueries({ queryKey: ["task-field-values-property", ctx.propertyId] }),
      qc.invalidateQueries({ queryKey: ["task-field-files", ctx.taskId] }),
      qc.invalidateQueries({ queryKey: ["task-detail-meta", ctx.taskId] }),
    ]);
  }

  async function upload(list: FileList | null) {
    if (!list || list.length === 0) return;
    setBusy(true);
    try {
      for (const file of Array.from(list)) {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch(
          `/api/properties/${ctx.propertyId}/tasks/${ctx.taskId}/attachments?field=${field.id}`,
          { method: "POST", body: form },
        );
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          toast.error(body.error ?? `Couldn't upload ${file.name}`);
        }
      }
      await refresh();
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function open(f: FieldFile) {
    const supabase = createClient();
    const { data } = await supabase.storage
      .from("task-attachments")
      .createSignedUrl(f.storage_path, 300);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  async function remove(f: FieldFile) {
    const res = await removeTaskAttachment(f.id);
    if (res && "error" in res) toast.error(res.error);
    await refresh();
  }

  return (
    <div className={cn("flex min-w-0 items-center gap-1", singleLine ? "flex-nowrap" : "flex-wrap")}>
      {files.map((f) => (
        <span
          key={f.id}
          className="group/file inline-flex max-w-[12rem] items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-xs text-foreground"
        >
          <FileText className="size-3 shrink-0 text-muted-foreground" />
          <button
            type="button"
            onClick={() => void open(f)}
            className="truncate hover:underline"
            title={f.file_name}
          >
            {f.file_name}
          </button>
          {!disabled ? (
            <button
              type="button"
              aria-label={`Remove ${f.file_name}`}
              onClick={() => void remove(f)}
              className="text-muted-foreground opacity-0 transition-opacity group-hover/file:opacity-100 hover:text-foreground"
            >
              <X className="size-3" />
            </button>
          ) : null}
        </span>
      ))}
      {count > 0 && files.length === 0 ? (
        <span className="text-xs text-muted-foreground">{count} file{count === 1 ? "" : "s"}</span>
      ) : null}
      <button
        type="button"
        disabled={disabled || busy}
        onClick={() => inputRef.current?.click()}
        className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent"
      >
        {busy ? <Loader2 className="size-3 animate-spin" /> : <Upload className="size-3" />}
        {count === 0 ? (placeholder === "—" ? "Upload" : "Upload") : null}
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        onChange={(e) => void upload(e.target.files)}
      />
    </div>
  );
}

/* ── Progress (computed) ────────────────────────────────────────────────── */

export function ProgressFieldDisplay({ ctx }: { ctx: FieldEditorContext }) {
  const { data: tasks = [] } = useQuery(tasksQueryOptions(ctx.propertyId));
  const { done, total } = useMemo(() => {
    const self = tasks.find((t) => t.id === ctx.taskId) as
      | { checklist_total?: number; checklist_done?: number }
      | undefined;
    const children = tasks.filter((t) => t.parent_id === ctx.taskId);
    return {
      done: children.filter((t) => isDone(t)).length + (self?.checklist_done ?? 0),
      total: children.length + (self?.checklist_total ?? 0),
    };
  }, [tasks, ctx.taskId]);
  if (total === 0) {
    return <span className="px-1.5 text-sm text-faint-foreground">No sub-issues yet</span>;
  }
  const pct = Math.round((done / total) * 100);
  return (
    <span className="flex items-center gap-2 px-1.5" title={`${done} of ${total} done`}>
      <Progress value={pct} className="h-1.5 flex-1" />
      <span className="text-xs text-muted-foreground tabular-nums">
        {done}/{total}
      </span>
    </span>
  );
}

/* ── url / email / phone / currency / long text ─────────────────────────── */

/**
 * Inline text editor with per-type validation through the SAME coercion the
 * server runs. Idle display: links are clickable, money is formatted.
 */
export function ValidatedTextEditor({
  field,
  value,
  disabled,
  onSave,
  placeholder,
}: {
  field: CustomFieldRow;
  value: CustomFieldValue | null;
  disabled?: boolean;
  onSave: (v: CustomFieldValue | null) => void;
  placeholder: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  useEffect(() => {
    if (editing) ref.current?.focus();
  }, [editing]);

  const current = value === null || value === undefined ? "" : String(value);
  const display =
    field.type === "currency" && typeof value === "number"
      ? formatCurrency(value, field.config)
      : current;
  const href =
    !current
      ? null
      : field.type === "url"
        ? current
        : field.type === "email"
          ? `mailto:${current}`
          : field.type === "phone"
            ? `tel:${current.replace(/[^0-9+]/g, "")}`
            : null;

  function commit() {
    setEditing(false);
    if (draft.trim() === current.trim()) return;
    const res = coerceFieldValue(field, draft);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    if (res.value !== value) onSave(res.value);
  }

  if (!editing) {
    return (
      <div className="flex min-w-0 items-center gap-1">
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            setDraft(field.type === "currency" && typeof value === "number" ? String(value) : current);
            setEditing(true);
          }}
          className={cn(ROW, "flex-1", field.type === "long_text" && "line-clamp-2 whitespace-pre-line")}
        >
          {display ? (
            <span className={cn("truncate text-foreground", field.type === "currency" && "tabular-nums")}>
              {display}
            </span>
          ) : (
            <span className="text-muted-foreground">{placeholder}</span>
          )}
        </button>
        {href ? (
          <a
            href={href}
            target={field.type === "url" ? "_blank" : undefined}
            rel="noopener noreferrer"
            aria-label={`Open ${field.name}`}
            className="shrink-0 rounded-md p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ExternalLink className="size-3" />
          </a>
        ) : null}
      </div>
    );
  }

  const common = {
    value: draft,
    disabled,
    onChange: (e: React.ChangeEvent<HTMLInputElement & HTMLTextAreaElement>) => setDraft(e.target.value),
    onBlur: commit,
    className:
      "w-full rounded-md bg-accent px-1.5 py-0.5 text-sm text-foreground outline-none placeholder:text-muted-foreground",
  };
  if (field.type === "long_text") {
    return (
      <textarea
        ref={ref}
        rows={4}
        {...common}
        onKeyDown={(e) => {
          if (e.key === "Escape") setEditing(false);
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.blur();
        }}
      />
    );
  }
  return (
    <input
      ref={ref}
      type={field.type === "email" ? "email" : field.type === "phone" ? "tel" : "text"}
      inputMode={field.type === "currency" ? "decimal" : undefined}
      placeholder={
        field.type === "currency"
          ? `${field.config?.code ?? ""} 0.00`.trim()
          : field.type === "url"
            ? "example.com"
            : undefined
      }
      {...common}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") setEditing(false);
      }}
    />
  );
}
