"use client";

import { useWorkflowBuilderData } from "@/components/workflows/builder/workflow-builder-data";

/** Distinct task labels for this property — shared via WorkflowBuilderDataProvider. */
export function useTaskLabels(propertyId?: string) {
  const ctx = useWorkflowBuilderData();
  const active = ctx && (!propertyId || ctx.propertyId === propertyId);

  return {
    labels: active ? ctx.taskLabels : [],
    loading: active ? ctx.taskLabelsLoading : false,
  };
}
