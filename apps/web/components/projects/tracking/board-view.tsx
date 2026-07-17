"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { CalendarDays } from "lucide-react";
import {
  DndContext,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { CountBadge } from "@/components/ui/count-badge";
import { PortalDragOverlay } from "@/components/ui/portal-drag-overlay";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { ProjectTracking } from "@/lib/query/project-queries";
import type { ProjectStatus } from "@/lib/db/types";
import { updateProject } from "@/components/projects/actions";
import {
  COLOR_DOT,
  ContributorStack,
  HEALTH_META,
  PROJECT_STATUS_META,
  ProgressBar,
  STATUS_ORDER,
  progressPct,
  projectHealth,
  shortDate,
  type ProjectMember,
  type ProjectsViewProps,
} from "./tracking-shared";

/** Is this droppable id one of the status columns? */
function isStatus(id: string): id is ProjectStatus {
  return (STATUS_ORDER as string[]).includes(id);
}

/* ── Card ─────────────────────────────────────────────────────────────────── */

function CardBody({
  project,
  members,
  dragging,
}: {
  project: ProjectTracking;
  members: ProjectMember[];
  dragging?: boolean;
}) {
  const health = projectHealth(project);
  const healthMeta = HEALTH_META[health];
  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-xl border border-border/70 bg-card p-3 transition-shadow",
        dragging
          ? "shadow-lg ring-1 ring-border"
          : "hover:border-border hover:shadow-sm",
      )}
    >
      <div className="flex items-center gap-2">
        {project.icon ? (
          <span className="shrink-0 text-sm leading-none">{project.icon}</span>
        ) : (
          <span
            className={cn(
              "size-2.5 shrink-0 rounded-full",
              COLOR_DOT[project.color],
            )}
            aria-hidden="true"
          />
        )}
        <span className="min-w-0 flex-1 truncate text-sm font-medium tracking-tight text-foreground">
          {project.name || "Untitled project"}
        </span>
        <span
          title={healthMeta.label}
          className={cn("size-2 shrink-0 rounded-full", healthMeta.dot)}
          aria-label={healthMeta.label}
        />
      </div>

      <div className="flex items-center gap-2.5">
        <ProgressBar done={project.done} total={project.total} className="flex-1" />
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {project.done}/{project.total}
        </span>
        <span className="w-9 shrink-0 text-right text-xs font-medium tabular-nums text-foreground">
          {progressPct(project.done, project.total)}%
        </span>
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs tabular-nums text-muted-foreground">
          <CalendarDays className="size-3.5" strokeWidth={1.75} />
          {shortDate(project.target_date)}
        </span>
        <ContributorStack
          ids={project.contributorIds}
          members={members}
          size="size-5"
        />
      </div>
    </div>
  );
}

function DraggableCard({
  propertyId,
  project,
  members,
}: {
  propertyId: string;
  project: ProjectTracking;
  members: ProjectMember[];
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: project.id,
  });
  return (
    <Link
      ref={setNodeRef}
      href={`/p/${propertyId}/projects/${project.id}`}
      className={cn(
        "block touch-none rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring",
        isDragging && "opacity-40",
      )}
      {...attributes}
      {...listeners}
    >
      <CardBody project={project} members={members} />
    </Link>
  );
}

/* ── Column ───────────────────────────────────────────────────────────────── */

function Column({
  status,
  projects,
  propertyId,
  members,
  isOver,
}: {
  status: ProjectStatus;
  projects: ProjectTracking[];
  propertyId: string;
  members: ProjectMember[];
  isOver: boolean;
}) {
  const meta = PROJECT_STATUS_META[status];
  const { setNodeRef } = useDroppable({ id: status });
  return (
    <div className="flex min-w-[300px] flex-1 flex-col">
      <div className="mb-3 flex items-center gap-2 px-0.5">
        <span
          className={cn("size-2 shrink-0 rounded-full", meta.dot)}
          aria-hidden="true"
        />
        <h2 className="text-sm font-medium tracking-tight text-foreground">
          {meta.label}
        </h2>
        <CountBadge>{projects.length}</CountBadge>
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          "flex min-h-24 flex-1 flex-col gap-2 rounded-xl p-1.5 transition-colors",
          isOver ? "bg-muted/60 ring-1 ring-border" : "bg-muted/20",
        )}
      >
        {projects.length === 0 ? (
          <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-border/50 py-8 text-xs text-muted-foreground/70">
            No projects
          </div>
        ) : (
          projects.map((project) => (
            <DraggableCard
              key={project.id}
              propertyId={propertyId}
              project={project}
              members={members}
            />
          ))
        )}
      </div>
    </div>
  );
}

/* ── Board ────────────────────────────────────────────────────────────────── */

export function ProjectsBoardView({
  propertyId,
  projects,
  members,
  onChanged,
}: ProjectsViewProps) {
  // Local mirror of props so a drop can move a card optimistically.
  const [items, setItems] = useState<ProjectTracking[]>(projects);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overStatus, setOverStatus] = useState<ProjectStatus | null>(null);
  const draggingRef = useRef(false);

  useEffect(() => {
    if (draggingRef.current) return;
    setItems(projects);
  }, [projects]);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 180, tolerance: 6 },
    }),
  );

  const byStatus = useMemo(() => {
    const map: Record<ProjectStatus, ProjectTracking[]> = {
      planned: [],
      active: [],
      completed: [],
      archived: [],
    };
    for (const p of items) map[p.status]?.push(p);
    return map;
  }, [items]);

  const activeProject = activeId
    ? items.find((p) => p.id === activeId) ?? null
    : null;

  function handleDragStart(event: DragStartEvent) {
    draggingRef.current = true;
    setActiveId(String(event.active.id));
  }

  function resolveStatus(overId: string | null): ProjectStatus | null {
    if (!overId) return null;
    if (isStatus(overId)) return overId;
    const over = items.find((p) => p.id === overId);
    return over ? over.status : null;
  }

  function handleDragOver(event: { over: { id: string | number } | null }) {
    setOverStatus(resolveStatus(event.over ? String(event.over.id) : null));
  }

  async function handleDragEnd(event: DragEndEvent) {
    draggingRef.current = false;
    const id = String(event.active.id);
    setActiveId(null);
    setOverStatus(null);

    const project = items.find((p) => p.id === id);
    const nextStatus = resolveStatus(event.over ? String(event.over.id) : null);
    if (!project || !nextStatus || project.status === nextStatus) {
      setItems(projects);
      return;
    }

    const prev = items;
    // Optimistically reclassify.
    setItems((cur) =>
      cur.map((p) => (p.id === id ? { ...p, status: nextStatus } : p)),
    );

    const result = await updateProject(id, { status: nextStatus });
    if ("error" in result) {
      toast.error(result.error || "Could not move project");
      setItems(prev);
      return;
    }
    onChanged();
  }

  function handleDragCancel() {
    draggingRef.current = false;
    setActiveId(null);
    setOverStatus(null);
    setItems(projects);
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="flex h-full gap-4 overflow-x-auto px-8 py-8 sm:px-14">
        {STATUS_ORDER.map((status) => (
          <Column
            key={status}
            status={status}
            projects={byStatus[status]}
            propertyId={propertyId}
            members={members}
            isOver={overStatus === status}
          />
        ))}
      </div>
      <PortalDragOverlay
        dropAnimation={{ duration: 200, easing: "cubic-bezier(0.2, 0, 0, 1)" }}
      >
        {activeProject ? (
          <div className="min-w-[280px] cursor-grabbing">
            <CardBody project={activeProject} members={members} dragging />
          </div>
        ) : null}
      </PortalDragOverlay>
    </DndContext>
  );
}
