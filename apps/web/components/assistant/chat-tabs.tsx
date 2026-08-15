"use client";

import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { restrictToHorizontalAxis } from "@dnd-kit/modifiers";
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { MessageSquare, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The tab strip — several conversations open at once, switched instantly
 * because every open pane stays mounted behind it (see AssistantWorkspace).
 *
 * Reordering uses a plain sortable with no DragOverlay: the tabs are small,
 * fixed-height, and never leave their row, so the in-place transform reads
 * correctly and we avoid the portal dance the board columns need. An 8px
 * activation distance keeps a click-to-switch from being read as a drag.
 */

export type ChatTab = {
  id: string;
  title: string;
  /** Shown as a dot — the tab has streamed something you haven't looked at. */
  unread?: boolean;
  busy?: boolean;
};

export function ChatTabs({
  tabs,
  activeId,
  onSelect,
  onClose,
  onNew,
  onReorder,
}: {
  tabs: ChatTab[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
  onReorder: (ids: string[]) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = tabs.map((t) => t.id);
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    const next = [...ids];
    next.splice(to, 0, next.splice(from, 1)[0]);
    onReorder(next);
  }

  return (
    <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border px-2">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToHorizontalAxis]}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={tabs.map((t) => t.id)}
          strategy={horizontalListSortingStrategy}
        >
          <div
            role="tablist"
            aria-label="Open conversations"
            className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
          >
            {tabs.map((tab) => (
              <Tab
                key={tab.id}
                tab={tab}
                active={tab.id === activeId}
                onSelect={onSelect}
                onClose={onClose}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      <button
        type="button"
        onClick={onNew}
        aria-label="New conversation"
        title="New conversation"
        className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <Plus className="size-4" />
      </button>
    </div>
  );
}

function Tab({
  tab,
  active,
  onSelect,
  onClose,
}: {
  tab: ChatTab;
  active: boolean;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: tab.id });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        "group flex h-7 min-w-0 shrink-0 items-center gap-1.5 rounded-md pr-1 pl-2 text-sm transition-colors",
        active
          ? "bg-accent-pressed text-foreground"
          : "text-secondary-ink hover:bg-accent",
        isDragging && "z-10 opacity-80",
      )}
      {...attributes}
      {...listeners}
    >
      <button
        type="button"
        role="tab"
        aria-selected={active}
        onClick={() => onSelect(tab.id)}
        className="flex min-w-0 items-center gap-1.5"
      >
        {tab.busy ? (
          <span
            aria-hidden
            className="size-1.5 shrink-0 animate-pulse rounded-full bg-info"
          />
        ) : (
          <MessageSquare className="size-3.5 shrink-0 text-faint-foreground" />
        )}
        <span className="max-w-40 truncate">{tab.title}</span>
        {tab.unread && !active ? (
          <span aria-label="New reply" className="size-1.5 shrink-0 rounded-full bg-info" />
        ) : null}
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClose(tab.id);
        }}
        aria-label={`Close ${tab.title}`}
        // Reveal on hover/focus only — a permanently visible × on every tab
        // turns the strip into a row of buttons rather than a row of places.
        className={cn(
          "flex size-5 shrink-0 items-center justify-center rounded-pill text-faint-foreground transition-colors",
          "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-accent-pressed hover:text-foreground",
          active && "opacity-100",
        )}
      >
        <X className="size-3" />
      </button>
    </div>
  );
}
