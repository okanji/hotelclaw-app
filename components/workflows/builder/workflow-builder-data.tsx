"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { channelsQueryOptions, tasksQueryOptions } from "@/lib/query/section-queries";
import type { PropertyChannel } from "@/lib/chat/channels";
import type { Task } from "@/components/tasks/kanban";

function collectTaskLabels(tasks: Task[]): string[] {
  const seen = new Set<string>();
  for (const t of tasks) {
    for (const l of t.labels ?? []) {
      const trimmed = l.trim();
      if (trimmed) seen.add(trimmed);
    }
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}

type WorkflowBuilderData = {
  propertyId: string;
  taskLabels: string[];
  taskLabelsLoading: boolean;
  channels: PropertyChannel[];
  channelsLoading: boolean;
};

const WorkflowBuilderDataContext = createContext<WorkflowBuilderData | null>(null);

export function WorkflowBuilderDataProvider({
  propertyId,
  children,
}: {
  propertyId: string;
  children: ReactNode;
}) {
  const { data: tasks, isLoading: tasksLoading } = useQuery(tasksQueryOptions(propertyId));
  const { data: channels = [], isLoading: channelsLoading } = useQuery(
    channelsQueryOptions(propertyId),
  );

  const taskLabels = useMemo(() => collectTaskLabels(tasks ?? []), [tasks]);

  const value = useMemo(
    () => ({
      propertyId,
      taskLabels,
      taskLabelsLoading: tasksLoading,
      channels,
      channelsLoading,
    }),
    [propertyId, taskLabels, tasksLoading, channels, channelsLoading],
  );

  return (
    <WorkflowBuilderDataContext.Provider value={value}>
      {children}
    </WorkflowBuilderDataContext.Provider>
  );
}

export function useWorkflowBuilderData(): WorkflowBuilderData | null {
  return useContext(WorkflowBuilderDataContext);
}
