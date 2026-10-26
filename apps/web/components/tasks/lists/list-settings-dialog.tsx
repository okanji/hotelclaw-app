"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Archive,
  GripVertical,
  Loader2,
  Plus,
  Settings2,
  Trash2,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { NativeSelect } from "@/components/ui/native-select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { LABEL_COLORS, LABEL_DOT } from "@/components/labels/label-tokens";
import { StatusIcon } from "@/components/tasks/task-icons";
import { useStatusCatalog } from "@/lib/query/status-queries";
import { spacesQueryOptions } from "@/lib/query/project-queries";
import { useMyRole } from "@/components/chat/info-panel/use-my-role";
import { canManage } from "@/lib/auth/roles";
import {
  CATEGORY_META,
  STATUS_CATEGORIES,
  type StatusRow,
} from "@/lib/tasks/statuses";
import {
  deleteBlocker,
  fallbackFor,
  problemMessage,
  validateSet,
} from "@/lib/tasks/status-set-rules";
import type { EntityColor, StatusCategory } from "@/lib/db/types";
import { archiveList, updateList } from "./actions";
import {
  createStatus,
  deleteStatus,
  forkListStatuses,
  inheritListStatuses,
  reorderStatuses,
  updateStatus,
} from "./status-actions";

const CATEGORY_LABEL: Record<StatusCategory, string> = {
  open: "Not started (entry)",
  unstarted: "Not started",
  active: "Active",
  done: "Done",
  closed: "Closed (final)",
};

/**
 * List settings (0114): General (name / colour / icon / description),
 * **Statuses** — the pipeline editor, Linear's settings layout on ClickUp's
 * model: a list either INHERITS its team's set (one pipeline shared by every
 * list that inherits it; editing it here edits it for all of them) or owns a
 * fork ("Customise for this list"). Rows are renamed inline, recoloured,
 * recategorised, flagged blocked, dragged into order, added and deleted
 * (tasks of a deleted status move to the closest remaining one). Every
 * write is management-only server-side; the UI reads the role to say so.
 * Danger: archive the list.
 */
export function ListSettingsDialog({
  open,
  onOpenChange,
  propertyId,
  listId,
  currentUserId,
  initialTab = "general",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  propertyId: string;
  listId: string;
  currentUserId?: string;
  initialTab?: "general" | "statuses" | "danger";
}) {
  const catalog = useStatusCatalog(propertyId);
  const list = catalog.listById(listId);
  const role = useMyRole(propertyId, currentUserId);
  const management = role ? canManage(role) : false;

  if (!list) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-medium">
            <Settings2 className="size-4 text-muted-foreground" />
            {list.name}
          </DialogTitle>
          <DialogDescription className="sr-only">List settings</DialogDescription>
        </DialogHeader>
        {/* The content unmounts with the dialog, so the tab state below
            starts from `initialTab` on every open. */}
        <SettingsTabs
          propertyId={propertyId}
          list={list}
          management={management}
          roleKnown={role !== null}
          initialTab={initialTab}
          onArchived={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function SettingsTabs({
  propertyId,
  list,
  management,
  roleKnown,
  initialTab,
  onArchived,
}: {
  propertyId: string;
  list: NonNullable<ReturnType<ReturnType<typeof useStatusCatalog>["listById"]>>;
  management: boolean;
  roleKnown: boolean;
  initialTab: "general" | "statuses" | "danger";
  onArchived: () => void;
}) {
  const [tab, setTab] = useState<string>(initialTab);
  return (
        <Tabs value={tab} onValueChange={(v) => setTab(String(v))}>
          <TabsList>
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="statuses">Statuses</TabsTrigger>
            {!list.is_default ? <TabsTrigger value="danger">Danger</TabsTrigger> : null}
          </TabsList>
          <TabsContent value="general" className="pt-4">
            <GeneralTab propertyId={propertyId} list={list} />
          </TabsContent>
          <TabsContent value="statuses" className="pt-4">
            <StatusesTab
              propertyId={propertyId}
              list={list}
              management={management}
              roleKnown={roleKnown}
            />
          </TabsContent>
          {!list.is_default ? (
            <TabsContent value="danger" className="pt-4">
              <DangerTab propertyId={propertyId} list={list} onArchived={onArchived} />
            </TabsContent>
          ) : null}
        </Tabs>
  );
}

/* ── General ─────────────────────────────────────────────────────────────── */

function GeneralTab({
  propertyId,
  list,
}: {
  propertyId: string;
  list: NonNullable<ReturnType<ReturnType<typeof useStatusCatalog>["listById"]>>;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(list.name);
  const [icon, setIcon] = useState(list.icon ?? "");
  const [description, setDescription] = useState(list.description ?? "");
  const [busy, setBusy] = useState(false);
  const refresh = () =>
    qc.invalidateQueries({ queryKey: ["status-catalog", propertyId] });

  async function save() {
    setBusy(true);
    const res = await updateList({
      listId: list.id,
      name: name.trim() || list.name,
      icon: icon.trim() || null,
      description: description.trim() || null,
    });
    setBusy(false);
    if ("error" in res) return void toast.error(res.error);
    toast.success("Saved");
    void refresh();
  }
  async function recolor(color: EntityColor) {
    const res = await updateList({ listId: list.id, color });
    if ("error" in res) toast.error(res.error);
    else void refresh();
  }

  return (
    <div className="space-y-4">
      <Field label="Name">
        <Input value={name} onChange={(e) => setName(e.target.value)} className="h-9" />
      </Field>
      <Field label="Color">
        <div className="flex items-center gap-2">
          {LABEL_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={c}
              onClick={() => void recolor(c)}
              className={cn(
                "flex size-7 items-center justify-center rounded-md transition-colors hover:bg-accent",
                list.color === c && "bg-accent-pressed shadow-focus",
              )}
            >
              <span className={cn("size-4 rounded-full", LABEL_DOT[c])} />
            </button>
          ))}
        </div>
      </Field>
      <Field label="Icon">
        <Input
          value={icon}
          onChange={(e) => setIcon(e.target.value.slice(0, 2))}
          placeholder="Paste an emoji"
          className="h-9 max-w-[12rem]"
        />
      </Field>
      <Field label="Description">
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          placeholder="What lives in this list, and who works it."
        />
      </Field>
      <div className="flex justify-end">
        <Button onClick={() => void save()} disabled={busy}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : null}
          Save
        </Button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs/[1] font-medium text-faint-foreground">{label}</span>
      {children}
    </div>
  );
}

/* ── Statuses ────────────────────────────────────────────────────────────── */

function StatusesTab({
  propertyId,
  list,
  management,
  roleKnown,
}: {
  propertyId: string;
  list: NonNullable<ReturnType<ReturnType<typeof useStatusCatalog>["listById"]>>;
  management: boolean;
  roleKnown: boolean;
}) {
  const qc = useQueryClient();
  const catalog = useStatusCatalog(propertyId);
  const { data: spaces = [] } = useQuery(spacesQueryOptions(propertyId));
  const set = catalog.sets.get(list.status_set_id);
  const serverRows = catalog.statusesOfSet(list.status_set_id);
  const sharers = catalog.lists.filter(
    (l) => !l.archived_at && l.status_set_id === list.status_set_id,
  );
  const [busy, setBusy] = useState<string | null>(null);
  // Local order after a drag, keyed to the catalog snapshot it reordered —
  // a refetch (new `serverRows`) drops it without an effect.
  const [order, setOrder] = useState<{ base: StatusRow[]; ids: string[] } | null>(null);
  const rows = useMemo(() => {
    if (!order || order.base !== serverRows) return serverRows;
    const byId = new Map(serverRows.map((r) => [r.id, r]));
    const ordered = order.ids.map((id) => byId.get(id)).filter((r): r is StatusRow => !!r);
    for (const r of serverRows) if (!order.ids.includes(r.id)) ordered.push(r);
    return ordered;
  }, [order, serverRows]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["status-catalog", propertyId] });
    void qc.invalidateQueries({ queryKey: ["tasks", propertyId] });
  };
  const editable = management;
  const problems = validateSet(rows);
  const scopeName = list.space_id
    ? spaces.find((s) => s.id === list.space_id)?.name ?? "the team"
    : "the property";

  // Same sensor set as the kanban board (mouse + touch, not Pointer) — the
  // one combination proven to activate reliably in this app.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  async function run<T>(key: string, fn: () => Promise<T | { error: string }>, done?: (v: T) => void) {
    setBusy(key);
    const res = await fn();
    setBusy(null);
    if (res && typeof res === "object" && "error" in res) {
      toast.error(res.error);
      return;
    }
    refresh();
    done?.(res as T);
  }

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ids = rows.map((r) => r.id);
    const next = arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id)));
    setOrder({ base: serverRows, ids: next });
    void run("reorder", () => reorderStatuses({ setId: list.status_set_id, orderedIds: next }));
  }

  return (
    <div className="space-y-4">
      {/* Where this pipeline comes from, and the switch between inheriting
          and owning one. */}
      <div className="flex items-start justify-between gap-4 rounded-md bg-muted px-3 py-2.5">
        <div className="min-w-0 text-sm">
          {list.inherits_statuses ? (
            <>
              <p className="font-medium text-foreground">Using {scopeName}&apos;s statuses</p>
              <p className="text-pretty text-xs text-muted-foreground">
                Shared by {sharers.length} {sharers.length === 1 ? "list" : "lists"} — edits here
                change the pipeline for all of them. Customise to give this list its own.
              </p>
            </>
          ) : (
            <>
              <p className="font-medium text-foreground">This list&apos;s own statuses</p>
              <p className="text-pretty text-xs text-muted-foreground">
                {set?.name ?? "Custom"} pipeline. Switch back to {scopeName}&apos;s statuses to
                remap every task by category.
              </p>
            </>
          )}
        </div>
        <label className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
          Use {list.space_id ? "team" : "property"} statuses
          <Switch
            checked={list.inherits_statuses}
            disabled={!editable || busy !== null}
            onCheckedChange={(checked) =>
              void run(
                "inherit",
                () => (checked ? inheritListStatuses(list.id) : forkListStatuses(list.id)),
                () =>
                  toast.success(
                    checked
                      ? `Back on ${scopeName}'s statuses`
                      : "This list now has its own statuses",
                  ),
              )
            }
          />
        </label>
      </div>

      {!editable && roleKnown ? (
        <p className="text-xs text-muted-foreground">
          Only owners and managers can change a pipeline.
        </p>
      ) : null}

      {problems.length > 0 ? (
        <ul className="space-y-1 rounded-md bg-pill-warning px-3 py-2 text-xs text-pill-warning-ink">
          {problems.map((p, i) => (
            <li key={i}>{problemMessage(p)}</li>
          ))}
        </ul>
      ) : null}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={rows.map((r) => r.id)} strategy={verticalListSortingStrategy}>
          <ul className="space-y-1">
            {rows.map((row) => (
              <StatusRowEditor
                key={row.id}
                row={row}
                rows={rows}
                editable={editable}
                busy={busy === row.id}
                onPatch={(patch) =>
                  run(row.id, () => updateStatus({ statusId: row.id, ...patch }))
                }
                onDelete={() => {
                  const target = fallbackFor(rows, row.id);
                  void run(
                    row.id,
                    () => deleteStatus({ statusId: row.id, moveTasksTo: target?.id ?? null }),
                    (res) =>
                      toast.success(
                        res.moved > 0
                          ? `Removed “${row.name}” — ${res.moved} ${res.moved === 1 ? "task" : "tasks"} moved to “${target?.name}”`
                          : `Removed “${row.name}”`,
                      ),
                  );
                }}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>

      {editable ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="ghost" size="sm" disabled={busy !== null} />}
          >
            <Plus className="size-3.5" />
            Add status
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            {STATUS_CATEGORIES.map((c) => (
              <DropdownMenuItem
                key={c}
                className="gap-2"
                onClick={() =>
                  void run("add", () =>
                    createStatus({
                      setId: list.status_set_id,
                      name: nextName(CATEGORY_META[c].label, rows),
                      category: c,
                      color: CATEGORY_META[c].color,
                    }),
                  )
                }
              >
                <StatusIcon category={c} color={CATEGORY_META[c].color} className="size-3.5" />
                {CATEGORY_LABEL[c]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}

function nextName(base: string, rows: StatusRow[]): string {
  const taken = new Set(rows.map((r) => r.name.toLowerCase()));
  let name = base;
  for (let i = 2; taken.has(name.toLowerCase()); i += 1) name = `${base} ${i}`;
  return name;
}

function StatusRowEditor({
  row,
  rows,
  editable,
  busy,
  onPatch,
  onDelete,
}: {
  row: StatusRow;
  rows: StatusRow[];
  editable: boolean;
  busy: boolean;
  onPatch: (patch: {
    name?: string;
    category?: StatusCategory;
    isBlocked?: boolean;
    color?: EntityColor;
  }) => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: row.id, disabled: !editable });
  // Draft name, keyed to the saved name it edits — a rename landing from
  // the server (or another person) replaces the draft without an effect.
  const [draft, setDraft] = useState<{ base: string; value: string } | null>(null);
  const name = draft && draft.base === row.name ? draft.value : row.name;
  const setName = (value: string) => setDraft({ base: row.name, value });
  const blocker = deleteBlocker(rows, row.id);

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "flex items-center gap-2 rounded-md px-1.5 py-1",
        isDragging && "bg-accent shadow-card",
        busy && "opacity-60",
      )}
    >
      <button
        type="button"
        aria-label="Reorder"
        disabled={!editable}
        className="grid size-6 shrink-0 cursor-grab place-items-center rounded-md text-faint-foreground hover:bg-accent disabled:cursor-default disabled:opacity-40"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-3.5" />
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              aria-label="Color"
              disabled={!editable}
              className="grid size-6 shrink-0 place-items-center rounded-md hover:bg-accent disabled:pointer-events-none"
            />
          }
        >
          <StatusIcon
            category={row.category}
            blocked={row.is_blocked}
            color={row.color}
            className="size-4"
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {LABEL_COLORS.map((c) => (
            <DropdownMenuItem
              key={c}
              className="gap-2 capitalize"
              onClick={() => onPatch({ color: c })}
            >
              <span className={cn("size-2.5 rounded-full", LABEL_DOT[c])} />
              {c}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => {
          const t = name.trim();
          if (t && t !== row.name) onPatch({ name: t });
          else setName(row.name);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") setName(row.name);
        }}
        disabled={!editable}
        aria-label="Status name"
        className="h-7 min-w-0 flex-1"
      />

      <NativeSelect
        value={row.category}
        disabled={!editable}
        aria-label="Category"
        onChange={(e) => onPatch({ category: e.target.value as StatusCategory })}
        wrapperClassName="w-40 shrink-0"
        className="h-7 text-xs"
      >
        {STATUS_CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {CATEGORY_LABEL[c]}
          </option>
        ))}
      </NativeSelect>

      <label
        className={cn(
          "flex w-20 shrink-0 items-center gap-1.5 text-xs",
          row.category === "active" ? "text-muted-foreground" : "invisible",
        )}
      >
        <Switch
          size="sm"
          checked={row.is_blocked}
          disabled={!editable || row.category !== "active"}
          onCheckedChange={(v) => onPatch({ isBlocked: v })}
        />
        Blocked
      </label>

      <Button
        size="icon-xs"
        variant="ghost"
        aria-label={blocker ?? `Remove ${row.name}`}
        title={blocker ?? "Remove — its tasks move to the closest status"}
        disabled={!editable || !!blocker}
        onClick={onDelete}
        className="shrink-0 text-muted-foreground hover:text-destructive"
      >
        <Trash2 className="size-3.5" />
      </Button>
    </li>
  );
}

/* ── Danger ──────────────────────────────────────────────────────────────── */

function DangerTab({
  propertyId,
  list,
  onArchived,
}: {
  propertyId: string;
  list: NonNullable<ReturnType<ReturnType<typeof useStatusCatalog>["listById"]>>;
  onArchived: () => void;
}) {
  const qc = useQueryClient();
  const catalog = useStatusCatalog(propertyId);
  const [needsMove, setNeedsMove] = useState<number | null>(null);
  const [moveTo, setMoveTo] = useState<string>(
    () => (catalog.defaultListOf(list.space_id) ?? catalog.generalList())?.id ?? "",
  );
  const [busy, setBusy] = useState(false);
  const targets = catalog.lists.filter((l) => !l.archived_at && l.id !== list.id);

  async function archive(target?: string | null) {
    setBusy(true);
    const res = await archiveList({ listId: list.id, moveTasksTo: target });
    setBusy(false);
    if ("error" in res) return void toast.error(res.error);
    if ("needsMove" in res) return void setNeedsMove(res.needsMove);
    toast.success(`Archived “${list.name}”`);
    void qc.invalidateQueries({ queryKey: ["status-catalog", propertyId] });
    void qc.invalidateQueries({ queryKey: ["tasks", propertyId] });
    onArchived();
  }

  return (
    <div className="space-y-3 text-sm">
      <p className="text-pretty text-muted-foreground">
        Archiving hides the list from the sidebar and every picker. Its tasks
        must live somewhere, so open work moves to another list first.
      </p>
      {needsMove !== null ? (
        <div className="space-y-2 rounded-md bg-muted px-3 py-2.5">
          <p className="text-xs text-muted-foreground">
            {needsMove} open {needsMove === 1 ? "task" : "tasks"} move to:
          </p>
          <NativeSelect value={moveTo} onChange={(e) => setMoveTo(e.target.value)} className="h-8">
            {targets.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
                {l.is_default ? " (default)" : ""}
              </option>
            ))}
          </NativeSelect>
          <Button
            variant="destructive"
            size="sm"
            disabled={busy || !moveTo}
            onClick={() => void archive(moveTo)}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Archive className="size-3.5" />}
            Move tasks and archive
          </Button>
        </div>
      ) : (
        <Button variant="destructive" size="sm" disabled={busy} onClick={() => void archive()}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Archive className="size-3.5" />}
          Archive list
        </Button>
      )}
    </div>
  );
}
