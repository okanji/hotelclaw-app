"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryOptions } from "@tanstack/react-query";
import { Check, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/**
 * Intake-triage suggestions on the task detail — the visible rung of the
 * trust ladder. Each chip names the field, the suggested value, and (on
 * hover) the bot's one-line reasoning; accept applies the field, dismiss
 * records the rejection. Auto-applied fields show as a quiet provenance
 * badge instead of a decision, so graduated autonomy stays inspectable.
 */

type Suggestion = {
  id: string;
  field: "space" | "assignee" | "priority";
  suggested_value: string;
  display_value: string;
  reasoning: string;
  confidence: "low" | "medium" | "high";
  status: "pending" | "auto_applied";
};

const FIELD_LABEL: Record<Suggestion["field"], string> = {
  space: "Team",
  assignee: "Assignee",
  priority: "Priority",
};

export function taskSuggestionsQueryOptions(propertyId: string, taskId: string) {
  return queryOptions({
    queryKey: ["task-suggestions", propertyId, taskId] as const,
    staleTime: 30_000,
    queryFn: async (): Promise<Suggestion[]> => {
      const res = await fetch(
        `/api/properties/${propertyId}/tasks/${taskId}/suggestions`,
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error("Failed to load suggestions");
      const body = (await res.json()) as { suggestions: Suggestion[] };
      return body.suggestions;
    },
  });
}

export function TaskTriageSuggestions({
  propertyId,
  taskId,
}: {
  propertyId: string;
  taskId: string;
}) {
  const queryClient = useQueryClient();
  const { data: suggestions = [] } = useQuery(
    taskSuggestionsQueryOptions(propertyId, taskId),
  );

  const resolve = useMutation({
    mutationFn: async (args: {
      suggestionId: string;
      action: "accept" | "dismiss";
    }) => {
      const res = await fetch(
        `/api/properties/${propertyId}/tasks/${taskId}/suggestions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(args),
        },
      );
      if (!res.ok) throw new Error("Couldn't update the suggestion");
    },
    onSuccess: async (_d, args) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["task-suggestions", propertyId, taskId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["task-meta", propertyId, taskId],
        }),
        queryClient.invalidateQueries({ queryKey: ["tasks", propertyId] }),
      ]);
      if (args.action === "accept") toast.success("Applied");
    },
    onError: (e) => toast.error(e.message),
  });

  if (suggestions.length === 0) return null;

  const pending = suggestions.filter((s) => s.status === "pending");
  const applied = suggestions.filter((s) => s.status === "auto_applied");

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {pending.map((s) => (
        <span
          key={s.id}
          title={s.reasoning}
          className={cn(
            "flex items-center gap-1.5 rounded-full border border-dashed px-2.5 py-1 text-[0.75rem]",
            s.confidence === "high"
              ? "border-foreground/30 text-foreground"
              : "border-border text-muted-foreground",
          )}
        >
          <Sparkles className="size-3 shrink-0 opacity-60" />
          {FIELD_LABEL[s.field]}: {s.display_value}
          <button
            type="button"
            aria-label={`Accept ${FIELD_LABEL[s.field]} suggestion`}
            disabled={resolve.isPending}
            onClick={() =>
              resolve.mutate({ suggestionId: s.id, action: "accept" })
            }
            className="rounded-full p-0.5 text-emerald-600 hover:bg-emerald-500/10"
          >
            <Check className="size-3" />
          </button>
          <button
            type="button"
            aria-label={`Dismiss ${FIELD_LABEL[s.field]} suggestion`}
            disabled={resolve.isPending}
            onClick={() =>
              resolve.mutate({ suggestionId: s.id, action: "dismiss" })
            }
            className="rounded-full p-0.5 text-muted-foreground hover:bg-muted"
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      {applied.map((s) => (
        <span
          key={s.id}
          title={s.reasoning}
          className="flex items-center gap-1 rounded-full bg-muted/60 px-2.5 py-1 text-[0.6875rem] text-muted-foreground"
        >
          <Sparkles className="size-3 opacity-60" />
          {FIELD_LABEL[s.field]} set by AI
        </span>
      ))}
    </div>
  );
}
