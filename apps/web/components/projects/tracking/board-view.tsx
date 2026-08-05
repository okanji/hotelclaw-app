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
import { statusBadgeVariants } from "@/components/ui/status-badge";
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
  TeamChips,
  progressPct,
  projectHealth,
  shortDate,
  type ProjectMember,
  type ProjectTeam,
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
  teams,
  dragging,
}: {
  project: ProjectTracking;
  members: ProjectMember[];
  teams?: ProjectTeam[];
  dragging?: boolean;
}) {
  const health = projectHealth(project);
  const healthMeta = HEALTH_META[health];
  return (
    <div
      className={cn(
        // Card tier: a project card is a page (notion-spec-v2 §5) — 10px
        // radius + `shadow-card`, not the `rounded-md shadow-ring` WELL recipe.
        "flex flex-col gap-3 rounded-card bg-card px-2.5 py-2 shadow-card transition-colors",
        dragging && "shadow-popover",
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
        {/* Card title = CONTENT, 16px/24 weight 400 (notion-spec-v2 §2). */}
        <span className="min-w-0 flex-1 truncate text-base leading-6 font-normal text-foreground">
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

      {teams && teams.length > 0 ? <TeamChips teams={teams} /> : null}

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
  teams,
}: {
  propertyId: string;
  project: ProjectTracking;
  members: ProjectMember[];
  teams?: ProjectTeam[];
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: project.id,
  });
  return (
    <Link
      ref={setNodeRef}
      href={`/p/${propertyId}/projects/${project.id}`}
      className={cn(
        "block touch-none rounded-md outline-none focus-visible:shadow-focus",
        isDragging && "opacity-40",
      )}
      {...attributes}
      {...listeners}
    >
      <CardBody project={project} members={members} teams={teams} />
    </Link>
  );
}

/* ── Column ───────────────────────────────────────────────────────────────── */

function Column({
  status,
  projects,
  propertyId,
  members,
  teamsByProject,
  isOver,
}: {
  status: ProjectStatus;
  projects: ProjectTracking[];
  propertyId: string;
  members: ProjectMember[];
  teamsByProject?: Map<string, ProjectTeam[]>;
  isOver: boolean;
}) {
  const meta = PROJECT_STATUS_META[status];
  const { setNodeRef } = useDroppable({ id: status });
  return (
    <div className="flex min-w-[300px] flex-1 flex-col">
      {/* Group header = a tinted status pill + a faint count, and the column
          itself carries NO background (notion-spec-v2 §6). */}
      <div className="mb-3 flex items-center gap-2 px-0.5">
        <h2 className={cn(statusBadgeVariants({ tone: meta.tone }))}>
          {meta.label}
        </h2>
        <span className="text-sm text-faint-foreground tabular-nums">
          {projects.length}
        </span>
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          "flex min-h-24 flex-1 flex-col gap-2 rounded-md p-1.5 transition-colors",
          isOver && "bg-accent-pressed",
        )}
      >
        {projects.length === 0 ? (
          <div className="flex flex-1 items-center justify-center py-8 text-sm text-faint-foreground">
            No projects
          </div>
        ) : (
          projects.map((project) => (
            <DraggableCard
              key={project.id}
              propertyId={propertyId}
              project={project}
              members={members}
              teams={teamsByProject?.get(project.id)}
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
  teamsByProject,
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
            teamsByProject={teamsByProject}
            isOver={overStatus === status}
          />
        ))}
      </div>
      <PortalDragOverlay
        dropAnimation={{ duration: 200, easing: "cubic-bezier(0.2, 0, 0, 1)" }}
      >
        {activeProject ? (
          <div className="min-w-[280px] cursor-grabbing">
            <CardBody
              project={activeProject}
              members={members}
              teams={teamsByProject?.get(activeProject.id)}
              dragging
            />
          </div>
        ) : null}
      </PortalDragOverlay>
    </DndContext>
  );
}
