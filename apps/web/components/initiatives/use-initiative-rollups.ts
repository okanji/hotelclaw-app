"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { UpdateHealth } from "@/lib/db/types";
import {
  declaredHealthQueryOptions,
  initiativesQueryOptions,
  type Initiative,
} from "@/lib/query/initiative-queries";
import {
  projectsTrackingQueryOptions,
  type ProjectTracking,
} from "@/lib/query/project-queries";
import { projectHealth } from "@/components/projects/tracking/tracking-shared";
import {
  effectiveProjectHealth,
  initiativeHealth,
  type InitiativeHealth,
} from "@/lib/initiatives/planning";

/** A linked project with both health reads resolved. */
export type RolledProject = ProjectTracking & {
  declared: UpdateHealth | null;
  /** Declared if posted, else computed pace — what the roll-up counts. */
  effective: UpdateHealth | null;
};

export type InitiativeRollup = {
  initiative: Initiative;
  projects: RolledProject[];
  health: InitiativeHealth;
  activeProjects: number;
  done: number;
  total: number;
};

/**
 * Join initiatives × project tracking × declared health into the numbers the
 * list and detail pages render. Three cached queries, no extra fetch — the
 * projects index already warms `projects-tracking`.
 */
export function useInitiativeRollups(propertyId: string) {
  const initiativesQ = useQuery(initiativesQueryOptions(propertyId));
  const projectsQ = useQuery(projectsTrackingQueryOptions(propertyId));
  const healthQ = useQuery(declaredHealthQueryOptions(propertyId));

  const projectsById = useMemo(() => {
    const declared = healthQ.data?.projects ?? {};
    const map = new Map<string, RolledProject>();
    for (const p of projectsQ.data ?? []) {
      const d = declared[p.id]?.health ?? null;
      map.set(p.id, { ...p, declared: d, effective: effectiveProjectHealth(d, projectHealth(p)) });
    }
    return map;
  }, [projectsQ.data, healthQ.data]);

  const rollups = useMemo(() => {
    const declared = healthQ.data?.initiatives ?? {};
    return (initiativesQ.data ?? []).map((initiative): InitiativeRollup => {
      // Archived projects drop out of `projects-tracking`, so they drop out here.
      const projects = initiative.projectIds
        .map((id) => projectsById.get(id))
        .filter((p): p is RolledProject => Boolean(p));
      return {
        initiative,
        projects,
        health: initiativeHealth(
          declared[initiative.id]?.health ?? null,
          projects.filter((p) => p.status !== "completed").map((p) => p.effective),
        ),
        activeProjects: projects.filter((p) => p.status === "active").length,
        done: projects.reduce((n, p) => n + p.done, 0),
        total: projects.reduce((n, p) => n + p.total, 0),
      };
    });
  }, [initiativesQ.data, healthQ.data, projectsById]);

  return {
    rollups,
    projects: projectsQ.data ?? [],
    isPending: initiativesQ.isPending,
  };
}
