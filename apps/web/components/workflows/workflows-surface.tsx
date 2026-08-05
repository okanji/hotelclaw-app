"use client";

import { Suspense } from "react";
import { useSurfacePathname } from "@/lib/shell/use-surface-pathname";
import { WorkflowsList } from "./workflows-list";
import { WorkflowsNew } from "./workflows-new";
import { WorkflowDetail } from "./workflow-detail";
import { WorkflowRunsList } from "./workflow-runs";
import { AllRunsList } from "./all-runs";
import { WorkflowRunDetail } from "./workflow-run-detail";
import { WorkflowTemplates } from "./workflow-templates";
import {
  WorkflowEntitiesList,
  WorkflowEntityTypeView,
} from "./workflow-entities";

/** Any URL under the workflows section. */
const IN_WORKFLOWS = /^\/p\/[^/]+\/workflows(?:\/|$)/;

const ROUTES = {
  list: /^\/p\/[^/]+\/workflows\/?$/,
  new: /^\/p\/[^/]+\/workflows\/new\/?$/,
  allRuns: /^\/p\/[^/]+\/workflows\/runs\/?$/,
  templates: /^\/p\/[^/]+\/workflows\/templates\/?$/,
  entitiesList: /^\/p\/[^/]+\/workflows\/entities\/?$/,
  entitiesType: /^\/p\/[^/]+\/workflows\/entities\/([^/]+)\/?$/,
  runDetail:
    /^\/p\/[^/]+\/workflows\/([^/]+)\/runs\/([^/]+)\/?$/,
  runsList: /^\/p\/[^/]+\/workflows\/([^/]+)\/runs\/?$/,
  detail: /^\/p\/[^/]+\/workflows\/([^/]+)\/?$/,
} as const;

/**
 * Persistent workflows surface — mounted in the property layout. Same
 * pattern as TasksSurface and DocumentsSurface: the section's page.tsx
 * files return null, this surface owns rendering, and in-section
 * navigation flows through `pushState` for zero round-trips.
 *
 * The gate reads `useSurfacePathname`, which stays in lockstep with the other
 * surfaces across both `router.push` sub-route nav and external `pushState`.
 */
export function WorkflowsSurface({ propertyId }: { propertyId: string }) {
  const pathname = useSurfacePathname();

  if (!IN_WORKFLOWS.test(pathname)) return null;

  // The order matters — more-specific routes win.
  const view = pickView(pathname, propertyId);

  return (
    <Suspense fallback={<LoadingFallback />}>
      {view}
    </Suspense>
  );
}

function pickView(pathname: string, propertyId: string) {
  if (ROUTES.list.test(pathname)) {
    return <WorkflowsList key="list" propertyId={propertyId} />;
  }
  if (ROUTES.new.test(pathname)) {
    return <WorkflowsNew key="new" propertyId={propertyId} />;
  }
  if (ROUTES.allRuns.test(pathname)) {
    return <AllRunsList key="all-runs" propertyId={propertyId} />;
  }
  if (ROUTES.templates.test(pathname)) {
    return <WorkflowTemplates key="templates" propertyId={propertyId} />;
  }
  const entityType = pathname.match(ROUTES.entitiesType);
  if (entityType) {
    const typeName = entityType[1];
    return (
      <WorkflowEntityTypeView
        key={`entity:${typeName}`}
        propertyId={propertyId}
        typeName={typeName}
      />
    );
  }
  if (ROUTES.entitiesList.test(pathname)) {
    return <WorkflowEntitiesList key="entities" propertyId={propertyId} />;
  }
  const runDetail = pathname.match(ROUTES.runDetail);
  if (runDetail) {
    const [, workflowId, runId] = runDetail;
    return (
      <WorkflowRunDetail
        key={`run:${runId}`}
        propertyId={propertyId}
        workflowId={workflowId}
        runId={runId}
      />
    );
  }
  const runsList = pathname.match(ROUTES.runsList);
  if (runsList) {
    const workflowId = runsList[1];
    return (
      <WorkflowRunsList
        key={`runs:${workflowId}`}
        propertyId={propertyId}
        workflowId={workflowId}
      />
    );
  }
  const detail = pathname.match(ROUTES.detail);
  if (detail) {
    const workflowId = detail[1];
    return (
      <WorkflowDetail
        key={`workflow:${workflowId}`}
        propertyId={propertyId}
        workflowId={workflowId}
      />
    );
  }
  // Inside /workflows/* but no route matched — fall back to the list.
  return <WorkflowsList key="list-fallback" propertyId={propertyId} />;
}

function LoadingFallback() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Mirrors the TabNav `underline` strip (40px + warm hairline) so the
          skeleton doesn't jump when the real sub-nav mounts. */}
      <div className="h-10 shrink-0 border-b border-border" />
      <div className="flex-1" />
    </div>
  );
}
