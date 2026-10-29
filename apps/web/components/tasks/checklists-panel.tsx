"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  CornerDownRight,
  GripVertical,
  ListChecks,
  MoreHorizontal,
  Plus,
  Trash2,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Gi } from "@/components/gr8r/icon";
import { ProgBar } from "@/components/gr8r/home-glyphs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { propertyMembersQueryOptions } from "@/lib/query/section-queries";
import {
  taskChecklistsQueryOptions,
  useTaskChecklistsRealtime,
  type ChecklistItemRow,
  type ChecklistRow,
} from "@/lib/query/checklist-queries";
import {
  checklistCounts,
  nestItems,
  positionBetween,
} from "@/lib/tasks/checklist-progress";
import { AssigneeStack } from "./assignee-stack";
import {
  addChecklistItem,
  createChecklist,
  deleteChecklist,
  deleteChecklistItem,
  renameChecklist,
  updateChecklistItem,
} from "./checklist-actions";

/**
 * Checklists on one task (0117) — ClickUp's "Task Prep": named lists of
 * tickable items, one level of nesting, an optional person per item, drag to
 * reorder. Enter on an item adds the next one below it; Backspace on an empty
 * item removes it. Ticks are optimistic; counters on the task row (the board
 * chip, the Progress field) follow over realtime.
 */
export function ChecklistsPanel({
  propertyId,
  taskId,
}: {
  propertyId: string;
  taskId: string;
}) {
  const qc = useQueryClient();
  useTaskChecklistsRealtime(propertyId, taskId);
  const key = taskChecklistsQueryOptions(taskId).queryKey;
  const { data } = useQuery(taskChecklistsQueryOptions(taskId));
  const [adding, setAdding] = useState(false);
  // Writes in flight. Ticking four items quickly used to let a refetch from
  // tick 3 land AFTER tick 4's optimistic patch and untick it on screen (the
  // DB was right) — so a patch cancels in-flight fetches and the refetch
  // waits until the last pending write has settled.
  const pending = useRef(0);

  const refresh = () => {
    pending.current = Math.max(0, pending.current - 1);
    if (pending.current > 0) return;
    void qc.invalidateQueries({ queryKey: key });
    void qc.invalidateQueries({ queryKey: ["tasks", propertyId] });
  };

  /** Optimistic patch of one item in the cache; pairs with one `refresh`. */
  const patchItem = (id: string, patch: Partial<ChecklistItemRow>) => {
    pending.current += 1;
    void qc.cancelQueries({ queryKey: key });
    qc.setQueryData(key, (prev) =>
      prev
        ? { ...prev, items: prev.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) }
        : prev,
    );
  };

  const checklists = data?.checklists ?? [];
  return (
    // gr8r drawer vocabulary: each checklist is a `.dsec` of `.subt` rows.
    <section className="g8-checklists" aria-label="Checklists">
      {checklists.map((c) => (
        <ChecklistBlock
          key={c.id}
          propertyId={propertyId}
          checklist={c}
          items={(data?.items ?? []).filter((i) => i.checklist_id === c.id)}
          onChanged={refresh}
          patchItem={patchItem}
        />
      ))}
      {adding ? (
        <NewChecklistForm
          onCancel={() => setAdding(false)}
          onCreate={async (name, items) => {
            const res = await createChecklist({ taskId, name, items });
            if ("error" in res) toast.error(res.error);
            else setAdding(false);
            refresh();
          }}
        />
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="btn btn-sm btn-ghost g8-cl-add"
        >
          <Gi icon={ListChecks} size={14} />
          Add checklist
        </button>
      )}
    </section>
  );
}

function NewChecklistForm({
  onCancel,
  onCreate,
}: {
  onCancel: () => void;
  onCreate: (name: string, items: string) => Promise<void>;
}) {
  const [name, setName] = useState("Checklist");
  const [items, setItems] = useState("");
  const [pending, start] = useTransition();
  return (
    <div className="cbox g8-cl-new">
      <input
        autoFocus
        value={name}
        maxLength={120}
        onChange={(e) => setName(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
          if (e.key === "Enter") {
            e.preventDefault();
            start(() => onCreate(name.trim() || "Checklist", items));
          }
        }}
        aria-label="Checklist name"
        className="inline-in g8-cl-new-name"
      />
      <textarea
        value={items}
        onChange={(e) => setItems(e.target.value)}
        rows={3}
        placeholder={"Items, one per line (optional)\n- Keys\n  - Spare set"}
        aria-label="Checklist items"
      />
      <div className="row">
        <span className="sp" />
        <button type="button" className="btn btn-sm btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-sm btn-primary"
          disabled={pending || !name.trim()}
          onClick={() => start(() => onCreate(name.trim(), items))}
        >
          Add checklist
        </button>
      </div>
    </div>
  );
}

function ChecklistBlock({
  propertyId,
  checklist,
  items,
  onChanged,
  patchItem,
}: {
  propertyId: string;
  checklist: ChecklistRow;
  items: ChecklistItemRow[];
  onChanged: () => void;
  patchItem: (id: string, patch: Partial<ChecklistItemRow>) => void;
}) {
  const nested = useMemo(() => nestItems(items), [items]);
  const { done, total } = checklistCounts(items);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(checklist.name);
  const [newText, setNewText] = useState("");
  const [focusId, setFocusId] = useState<string | null>(null);
  const newRef = useRef<HTMLInputElement>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  async function add(text: string, opts: { afterItemId?: string; parentItemId?: string | null } = {}) {
    const res = await addChecklistItem({ checklistId: checklist.id, text, ...opts });
    if ("error" in res) toast.error(res.error);
    else if (opts.afterItemId) setFocusId(res.id);
    onChanged();
  }

  async function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ids = nested.map((n) => n.id);
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    // Neighbours at the drop index once the dragged row is lifted out.
    const rest = nested.filter((n) => n.id !== active.id);
    const before = rest[to - 1];
    const after = rest[to];
    const position = positionBetween(before?.position ?? null, after?.position ?? null);
    patchItem(String(active.id), { position });
    const res = await updateChecklistItem({ itemId: String(active.id), position });
    if ("error" in res) toast.error(res.error);
    onChanged();
  }

  return (
    <div className="dsec">
      <div className="dsec-h g8-cl-h">
        {renaming ? (
          <input
            autoFocus
            value={name}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
            onBlur={async () => {
              setRenaming(false);
              if (name.trim() && name.trim() !== checklist.name) {
                const res = await renameChecklist({ checklistId: checklist.id, name: name.trim() });
                if ("error" in res) toast.error(res.error);
                onChanged();
              } else setName(checklist.name);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") {
                setName(checklist.name);
                setRenaming(false);
              }
            }}
            aria-label="Checklist name"
            className="inline-in g8-cl-rename"
          />
        ) : (
          <h3>
            <button
              type="button"
              onClick={() => setRenaming(true)}
              className="g8-cl-name"
            >
              {checklist.name}
            </button>
          </h3>
        )}
        <span className="cnt num">
          {done}/{total}
        </span>
        <span
          className="g8-dsec-prog"
          aria-label={`${checklist.name}: ${done} of ${total} done`}
        >
          <ProgBar
            value={total ? Math.round((done / total) * 100) : 0}
            tone={total > 0 && done === total ? "green" : ""}
          />
        </span>
        <div className="acts">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                aria-label={`${checklist.name} options`}
                className="ibtn ibtn-xs g8-cl-menu"
              />
            }
          >
            <Gi icon={MoreHorizontal} size={14} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setRenaming(true)}>Rename</DropdownMenuItem>
            <DropdownMenuItem
              disabled={done === total}
              onClick={async () => {
                for (const i of items.filter((x) => !x.done)) {
                  patchItem(i.id, { done: true });
                  await updateChecklistItem({ itemId: i.id, done: true });
                  onChanged();
                }
              }}
            >
              Check all
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive"
              onClick={async () => {
                const res = await deleteChecklist(checklist.id);
                if ("error" in res) toast.error(res.error);
                onChanged();
              }}
            >
              <Trash2 className="size-3.5" />
              Delete checklist
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        </div>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(e) => void onDragEnd(e)}>
        <SortableContext items={nested.map((n) => n.id)} strategy={verticalListSortingStrategy}>
          <ul className="g8-cl-list">
            {nested.map((item, idx) => (
              <SortableItem key={item.id} id={item.id}>
                {(handle) => (
                  <>
                    <ItemRow
                      propertyId={propertyId}
                      item={item}
                      handle={handle}
                      autoFocus={focusId === item.id}
                      canIndent={idx > 0}
                      onAddAfter={(text) => add(text, { afterItemId: item.id })}
                      onIndent={async () => {
                        const parent = nested[idx - 1];
                        if (!parent) return;
                        const res = await updateChecklistItem({
                          itemId: item.id,
                          parentItemId: parent.id,
                          position: (parent.children.at(-1)?.position ?? 0) + 1024,
                        });
                        if ("error" in res) toast.error(res.error);
                        onChanged();
                      }}
                      patchItem={patchItem}
                      onChanged={onChanged}
                    />
                    {item.children.length > 0 ? (
                      <ul className="g8-cl-list g8-cl-nest">
                        {item.children.map((child) => (
                          <ItemRow
                            key={child.id}
                            propertyId={propertyId}
                            item={child}
                            autoFocus={focusId === child.id}
                            onAddAfter={(text) =>
                              add(text, { afterItemId: child.id, parentItemId: item.id })
                            }
                            onOutdent={async () => {
                              const res = await updateChecklistItem({
                                itemId: child.id,
                                parentItemId: null,
                                position: positionBetween(item.position, nested[idx + 1]?.position ?? null),
                              });
                              if ("error" in res) toast.error(res.error);
                              onChanged();
                            }}
                            patchItem={patchItem}
                            onChanged={onChanged}
                          />
                        ))}
                      </ul>
                    ) : null}
                  </>
                )}
              </SortableItem>
            ))}
          </ul>
        </SortableContext>
      </DndContext>

      <div className="subt g8-subt-add">
        <Gi icon={Plus} size={15} />
        <input
          ref={newRef}
          value={newText}
          placeholder="Add an item"
          maxLength={500}
          onChange={(e) => setNewText(e.target.value)}
          onKeyDown={async (e) => {
            if (e.key === "Enter" && newText.trim()) {
              e.preventDefault();
              const text = newText.trim();
              setNewText("");
              await add(text);
              newRef.current?.focus();
            }
            if (e.key === "Escape") setNewText("");
          }}
          className="inline-in"
          aria-label={`Add an item to ${checklist.name}`}
        />
      </div>
    </div>
  );
}

function SortableItem({
  id,
  children,
}: {
  id: string;
  children: (handle: React.HTMLAttributes<HTMLButtonElement>) => React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(isDragging && "relative z-10 opacity-80")}
    >
      {children({ ...attributes, ...listeners })}
    </li>
  );
}

function ItemRow({
  propertyId,
  item,
  handle,
  autoFocus,
  canIndent,
  onAddAfter,
  onIndent,
  onOutdent,
  patchItem,
  onChanged,
}: {
  propertyId: string;
  item: ChecklistItemRow;
  handle?: React.HTMLAttributes<HTMLButtonElement>;
  autoFocus?: boolean;
  canIndent?: boolean;
  onAddAfter: (text: string) => Promise<void>;
  onIndent?: () => Promise<void>;
  onOutdent?: () => Promise<void>;
  patchItem: (id: string, patch: Partial<ChecklistItemRow>) => void;
  onChanged: () => void;
}) {
  const [text, setText] = useState(item.text);
  const [editing, setEditing] = useState(!!autoFocus);
  const [, start] = useTransition();
  const { data: members = [] } = useQuery(propertyMembersQueryOptions(propertyId));
  const assignee = item.assignee_id ? members.find((m) => m.id === item.assignee_id) : undefined;

  async function saveText() {
    setEditing(false);
    const next = text.trim();
    // An Enter-created row left untouched goes away instead of lingering.
    if (item.text === "New item" && (next === "" || next === "New item")) {
      await remove();
      return;
    }
    if (!next) {
      setText(item.text);
      return;
    }
    if (next === item.text) return;
    patchItem(item.id, { text: next });
    const res = await updateChecklistItem({ itemId: item.id, text: next });
    if ("error" in res) toast.error(res.error);
    onChanged();
  }

  async function remove() {
    const res = await deleteChecklistItem(item.id);
    if ("error" in res) toast.error(res.error);
    onChanged();
  }

  return (
    <div className={cn("subt g8-cl-item", item.done && "done")}>
      {handle ? (
        <button
          type="button"
          aria-label="Drag to reorder"
          className="g8-grip"
          {...handle}
        >
          <Gi icon={GripVertical} size={13} />
        </button>
      ) : (
        <span className="g8-grip-sp" />
      )}
      <input
        type="checkbox"
        className="check"
        checked={item.done}
        aria-label={item.done ? `Uncheck ${item.text}` : `Check ${item.text}`}
        onChange={(e) => {
          const c = e.currentTarget.checked;
          start(async () => {
            patchItem(item.id, { done: c });
            const res = await updateChecklistItem({ itemId: item.id, done: c });
            if ("error" in res) toast.error(res.error);
            onChanged();
          });
        }}
      />
      {editing ? (
        <input
          autoFocus
          value={text}
          maxLength={500}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => void saveText()}
          onKeyDown={async (e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              await saveText();
              await onAddAfter("New item");
            } else if (e.key === "Escape") {
              // Notion's model: Escape leaves the row KEEPING what you typed
              // (an untouched "New item" removes itself in saveText).
              e.currentTarget.blur();
            } else if (e.key === "Backspace" && text === "") {
              e.preventDefault();
              await remove();
            } else if (e.key === "Tab" && !e.shiftKey && canIndent && onIndent) {
              e.preventDefault();
              await saveText();
              await onIndent();
            } else if (e.key === "Tab" && e.shiftKey && onOutdent) {
              e.preventDefault();
              await saveText();
              await onOutdent();
            }
          }}
          onFocus={(e) => {
            if (item.text === "New item") e.currentTarget.select();
          }}
          className="inline-in g8-cl-edit"
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="s"
        >
          {item.text}
        </button>
      )}
      {assignee ? (
        <AssigneeStack
          ids={[assignee.id]}
          infos={{ [assignee.id]: { name: assignee.name ?? "Member", avatar: assignee.avatarUrl ?? undefined } }}
          size={20}
        />
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              aria-label={`Options for ${item.text}`}
              className="ibtn ibtn-xs x g8-cl-menu"
            />
          }
        >
          <Gi icon={MoreHorizontal} size={14} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <UserRound className="size-3.5" />
              {assignee ? `Assigned: ${assignee.name ?? "Member"}` : "Assign"}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="max-h-64 overflow-y-auto">
              <DropdownMenuItem
                onClick={async () => {
                  patchItem(item.id, { assignee_id: null });
                  await updateChecklistItem({ itemId: item.id, assigneeId: null });
                  onChanged();
                }}
              >
                Nobody
              </DropdownMenuItem>
              {members.map((m) => (
                <DropdownMenuItem
                  key={m.id}
                  onClick={async () => {
                    patchItem(item.id, { assignee_id: m.id });
                    const res = await updateChecklistItem({ itemId: item.id, assigneeId: m.id });
                    if ("error" in res) toast.error(res.error);
                    onChanged();
                  }}
                >
                  {m.name ?? m.email ?? "Member"}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          {canIndent && onIndent ? (
            <DropdownMenuItem onClick={() => void onIndent()}>
              <CornerDownRight className="size-3.5" />
              Make a sub-item
            </DropdownMenuItem>
          ) : null}
          {onOutdent ? (
            <DropdownMenuItem onClick={() => void onOutdent()}>Move out a level</DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-destructive" onClick={() => void remove()}>
            <Trash2 className="size-3.5" />
            Delete item
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
