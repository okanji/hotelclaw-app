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
import { Gi } from "@/components/gr8r/icon";

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
    <div className="g8-ctabs">
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
        className="ibtn ibtn-sm"
      >
        <Gi icon={Plus} size={15} />
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
      className={cn("g8-ctab", active && "on", isDragging && "z-10 opacity-80")}
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
          <span aria-hidden className="pdot animate-pulse" style={{ "--g8-c": "var(--g8-accent)", borderRadius: "50%", width: 6, height: 6 } as React.CSSProperties} />
        ) : (
          <Gi icon={MessageSquare} size={13} />
        )}
        <span className="max-w-40 truncate">{tab.title}</span>
        {tab.unread && !active ? (
          <span aria-label="New reply" className="pdot" style={{ "--g8-c": "var(--g8-accent)", borderRadius: "50%", width: 6, height: 6 } as React.CSSProperties} />
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
        className="ibtn ibtn-xs x"
      >
        <Gi icon={X} size={12} />
      </button>
    </div>
  );
}
