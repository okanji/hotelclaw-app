"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, CalendarRange, Columns3, Plus, Table2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  projectsTrackingQueryOptions,
  spacesQueryOptions,
} from "@/lib/query/project-queries";
import { propertyMembersQueryOptions } from "@/lib/query/section-queries";
import { CreateEntityDialog } from "./create-entity-dialog";
import {
  type ProjectMember,
  type ProjectsViewMode,
} from "./tracking/tracking-shared";
import { ProjectsBoardView } from "./tracking/board-view";
import { ProjectsTableView } from "./tracking/table-view";
import { ProjectsTimelineView } from "./tracking/timeline-view";

const VIEW_TABS: {
  id: ProjectsViewMode;
  label: string;
  Icon: typeof Columns3;
}[] = [
  { id: "table", label: "Table", Icon: Table2 },
  { id: "board", label: "Board", Icon: Columns3 },
  { id: "timeline", label: "Timeline", Icon: CalendarRange },
];

const VIEW_STORAGE_KEY = "projects:view";

export function ProjectsIndex({ propertyId }: { propertyId: string }) {
  const searchParams = useSearchParams();
  const spaceFilter = searchParams.get("space");
  const qc = useQueryClient();

  const { data: projects = [], isPending } = useQuery(
    projectsTrackingQueryOptions(propertyId),
  );
  const { data: spaces = [] } = useQuery(spacesQueryOptions(propertyId));
  const { data: members = [] } = useQuery(
    propertyMembersQueryOptions(propertyId),
  );
  const [createOpen, setCreateOpen] = useState(false);
  const [view, setView] = useState<ProjectsViewMode>("table");

  // Restore the last-used view (client-only; avoids a hydration mismatch).
  useEffect(() => {
    const saved = window.localStorage.getItem(VIEW_STORAGE_KEY);
    if (saved === "board" || saved === "table" || saved === "timeline") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setView(saved);
    }
  }, []);
  function changeView(next: ProjectsViewMode) {
    setView(next);
    window.localStorage.setItem(VIEW_STORAGE_KEY, next);
  }

  // When filtering by space, fetch that space's project ids.
  const { data: spaceProjectIds } = useQuery({
    queryKey: ["space-project-ids", spaceFilter] as const,
    enabled: !!spaceFilter,
    queryFn: async (): Promise<string[]> => {
      const supabase = createBrowserClient();
      const { data } = await supabase
        .from("project_spaces")
        .select("project_id")
        .eq("space_id", spaceFilter as string);
      return (data ?? []).map((r) => r.project_id);
    },
  });

  const spaceName = spaceFilter
    ? spaces.find((t) => t.id === spaceFilter)?.name
    : null;

  const shown = useMemo(() => {
    if (!spaceFilter) return projects;
    const ids = new Set(spaceProjectIds ?? []);
    return projects.filter((p) => ids.has(p.id));
  }, [projects, spaceFilter, spaceProjectIds]);

  const memberList: ProjectMember[] = members;

  function onChanged() {
    void qc.invalidateQueries({
      queryKey: ["projects-tracking", propertyId],
    });
    void qc.invalidateQueries({ queryKey: ["projects", propertyId] });
  }

  const viewProps = {
    propertyId,
    projects: shown,
    members: memberList,
    onChanged,
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <header className="flex flex-col gap-5 border-b border-border px-8 pt-12 pb-5 sm:px-14 sm:pt-14">
        <div className="flex items-end justify-between gap-4">
          <div className="flex flex-col gap-1.5">
            <p className="text-[0.6875rem] font-medium tracking-[0.18em] text-muted-foreground uppercase">
              {spaceName ? `Space · ${spaceName}` : "Workspace"}
            </p>
            <h1 className="text-[2.5rem] leading-none font-semibold tracking-tight text-foreground">
              Projects
            </h1>
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              title="Archive"
              aria-label="Archive"
              render={<Link href={`/p/${propertyId}/archive`} />}
            >
              <Archive className="size-4" />
            </Button>
            <Button type="button" size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" />
              New project
            </Button>
          </div>
        </div>

        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-0.5 rounded-lg border border-border/70 p-0.5">
            {VIEW_TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => changeView(t.id)}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[0.8125rem] font-medium tracking-tight transition-colors",
                  view === t.id
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <t.Icon className="size-3.5" />
                {t.label}
              </button>
            ))}
          </div>
          <span className="text-[0.8125rem] tabular-nums text-muted-foreground">
            {shown.length} {shown.length === 1 ? "project" : "projects"}
          </span>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-hidden">
        {isPending ? (
          <p className="px-8 pt-10 text-sm text-muted-foreground sm:px-14">
            Loading projects…
          </p>
        ) : shown.length === 0 ? (
          <div className="px-8 pt-10 sm:px-14">
            <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border/60 py-16 text-center">
              <p className="text-sm text-muted-foreground">
                {spaceName
                  ? `No projects involve ${spaceName} yet.`
                  : "No projects yet."}
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setCreateOpen(true)}
              >
                <Plus className="size-4" />
                New project
              </Button>
            </div>
          </div>
        ) : view === "board" ? (
          <ProjectsBoardView {...viewProps} />
        ) : view === "timeline" ? (
          <ProjectsTimelineView {...viewProps} />
        ) : (
          <ProjectsTableView {...viewProps} />
        )}
      </div>

      <CreateEntityDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        propertyId={propertyId}
        kind="project"
      />
    </div>
  );
}
