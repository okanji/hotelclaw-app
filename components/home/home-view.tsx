"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
} from "@dnd-kit/sortable";
import { Plus, RotateCcw, SlidersHorizontal, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CreateDocumentDialog } from "@/components/documents/create-document-dialog";
import { GenerateDocumentDialog } from "@/components/documents/generate-document-dialog";
import { tasksQueryOptions } from "@/lib/query/section-queries";
import { useNotifications } from "@/components/shell/use-notifications";
import {
  DASHBOARD_WIDGETS,
  DASHBOARD_WIDGET_IDS,
  WIDGETS_BY_ID,
} from "./dashboard-registry";
import { useDashboardLayout } from "./use-dashboard-layout";
import { EditorialSection, Stats } from "./editorial-section";

/**
 * Property "Home" — a personalized dashboard in the editorial language of the
 * Docs "Directory": a generous header with a personal at-a-glance summary, then
 * stacked sections (kicker + heading + hairline content, not cards). Each
 * section is drag-reorderable and can be hidden; the arrangement saves per
 * user. The personal activity feed lives in the second sidebar (HomeSection).
 */
export function HomeView({
  propertyId,
  userId,
  userName,
  propertyName,
}: {
  propertyId: string;
  userId: string;
  userName: string | null;
  propertyName: string;
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);
  const greeting = useGreeting(userName);

  const {
    order,
    visible,
    isHidden,
    isCollapsed,
    setOrder,
    toggleHidden,
    toggleCollapsed,
    reset,
  } = useDashboardLayout(propertyId, userId, DASHBOARD_WIDGET_IDS);

  const summary = usePersonalSummary(propertyId, userId);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = order.indexOf(String(active.id));
    const to = order.indexOf(String(over.id));
    if (from === -1 || to === -1) return;
    setOrder(arrayMove(order, from, to));
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col overflow-y-auto px-8 pt-12 pb-16 sm:px-14 sm:pt-16">
      <header className="flex flex-col gap-10">
        <div className="flex items-end justify-between gap-6">
          <p className="truncate text-[0.6875rem] font-medium tracking-[0.18em] text-muted-foreground uppercase">
            {propertyName}
          </p>
          <div className="flex items-center gap-1.5">
            <CustomizeMenu
              visibleCount={visible.length}
              isHidden={isHidden}
              onToggle={toggleHidden}
              onReset={reset}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setGenerateOpen(true)}
            >
              <Sparkles className="size-4" />
              Generate
            </Button>
            <Button type="button" size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" />
              New doc
            </Button>
          </div>
        </div>
        <div className="flex flex-col gap-5">
          <h1 className="text-[3.25rem] leading-none font-semibold tracking-tight text-foreground sm:text-[4rem]">
            {greeting}
          </h1>
          <p className="max-w-[52ch] text-[0.9375rem] leading-relaxed tracking-tight text-pretty text-muted-foreground">
            A snapshot of your day and what the team is moving — rearrange it to
            your liking, or hide what you don&apos;t need.
          </p>
          <div className="pt-3">
            <Stats
              items={[
                { label: "open tasks", value: summary.open },
                { label: "due ≤ 7d", value: summary.dueSoon },
                { label: "unread", value: summary.unread },
              ]}
            />
          </div>
        </div>
      </header>

      <hr className="my-12 border-border" />

      {visible.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border/60 py-16 text-center">
          <p className="text-sm text-muted-foreground">
            Every section is hidden.
          </p>
          <Button type="button" size="sm" variant="outline" onClick={reset}>
            <RotateCcw className="size-4" />
            Restore default layout
          </Button>
        </div>
      ) : (
        <div className="@container">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={visible} strategy={rectSortingStrategy}>
              <div className="grid grid-flow-row-dense grid-cols-1 items-start gap-x-10 gap-y-16 @4xl:grid-cols-2">
                {visible.map((id) => {
                  const def = WIDGETS_BY_ID.get(id);
                  if (!def) return null;
                  const { Component } = def;
                  return (
                    <EditorialSection
                      key={id}
                      id={id}
                      kicker={def.kicker}
                      title={def.title}
                      wide={def.wide}
                      collapsed={isCollapsed(id)}
                      onToggleCollapse={() => toggleCollapsed(id)}
                    >
                      <Component propertyId={propertyId} userId={userId} />
                    </EditorialSection>
                  );
                })}
              </div>
            </SortableContext>
          </DndContext>
        </div>
      )}

      <CreateDocumentDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        propertyId={propertyId}
      />
      <GenerateDocumentDialog
        open={generateOpen}
        onOpenChange={setGenerateOpen}
        propertyId={propertyId}
      />
    </div>
  );
}

function CustomizeMenu({
  visibleCount,
  isHidden,
  onToggle,
  onReset,
}: {
  visibleCount: number;
  isHidden: (id: string) => boolean;
  onToggle: (id: string) => void;
  onReset: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button type="button" size="sm" variant="ghost">
            <SlidersHorizontal className="size-4" />
            Customize
          </Button>
        }
      />
      <DropdownMenuContent align="end" sideOffset={6} className="w-52">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-[0.6875rem] tracking-wider text-muted-foreground uppercase">
            Sections
          </DropdownMenuLabel>
          {DASHBOARD_WIDGETS.map((w) => (
            <DropdownMenuCheckboxItem
              key={w.id}
              checked={!isHidden(w.id)}
              onSelect={(e) => e.preventDefault()}
              onCheckedChange={() => onToggle(w.id)}
              disabled={!isHidden(w.id) && visibleCount === 1}
            >
              {w.title}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onReset}>
          <RotateCcw className="size-4" />
          Reset layout
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Personal at-a-glance counts for the header: my open tasks, due-soon, and
 *  unread activity. Cheap client aggregation over already-cached queries. */
function usePersonalSummary(propertyId: string, userId: string) {
  const { data: tasks = [] } = useQuery(tasksQueryOptions(propertyId));
  const { unseenCount } = useNotifications(userId);

  return useMemo(() => {
    const mineOpen = tasks.filter(
      (t) => t.assignee_id === userId && t.status !== "done",
    );
    // eslint-disable-next-line react-hooks/purity
    const cutoff = Date.now() + 7 * 24 * 60 * 60 * 1000;
    const dueSoon = mineOpen.filter(
      (t) => t.due_at && new Date(t.due_at).getTime() <= cutoff,
    ).length;
    return { open: mineOpen.length, dueSoon, unread: unseenCount };
  }, [tasks, userId, unseenCount]);
}

/** Time-of-day greeting; computed in an effect so it's SSR-safe (and pure). */
function useGreeting(name: string | null): string {
  const [greeting, setGreeting] = useState("Welcome back");
  useEffect(() => {
    const h = new Date().getHours();
    const part =
      h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
    const first = name?.trim().split(/\s+/)[0];
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setGreeting(first ? `${part}, ${first}` : part);
  }, [name]);
  return greeting;
}
