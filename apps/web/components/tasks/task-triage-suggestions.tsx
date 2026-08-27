"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryOptions } from "@tanstack/react-query";
import { Check, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { RecommendationCard } from "@/components/ai/recommendation-card";

/**
 * Intake-triage suggestions on the task detail — the visible rung of the
 * trust ladder, presented through the house RecommendationCard: one card per
 * suggested field, the bot's confidence as the segmented meter, and its
 * deterministic reasoning (similar-task overlap) behind the quiet "Why"
 * disclosure. Accept/dismiss keep their exact server actions. Auto-applied
 * fields drop to a quiet provenance line, so graduated autonomy stays
 * inspectable.
 *
 * No alternatives drawer here, deliberately: the suggestions API returns only
 * the validated pick (candidate lists live server-side in the triage bot),
 * and the accept action applies the stored suggested_value — it takes no
 * value override — so there is nothing a promoted alternative could apply
 * through the existing path.
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

const CONFIDENCE_LABEL: Record<Suggestion["confidence"], string> = {
  high: "High confidence",
  medium: "Medium confidence",
  low: "Needs review",
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
    <div className="flex flex-col gap-2">
      {pending.length > 0 ? (
        <div className="flex items-center gap-1.5 text-xs/[1] font-medium text-faint-foreground">
          <Sparkles className="size-3 shrink-0" aria-hidden />
          Suggested for this task
        </div>
      ) : null}

      {pending.map((s) => (
        <RecommendationCard
          key={s.id}
          title={`Set ${FIELD_LABEL[s.field].toLowerCase()} to`}
          recommended={{ label: s.display_value }}
          confidence={{ level: s.confidence, label: CONFIDENCE_LABEL[s.confidence] }}
          basis={[s.reasoning]}
          primaryCta={{
            label: "Accept",
            busy:
              resolve.isPending &&
              resolve.variables?.suggestionId === s.id &&
              resolve.variables?.action === "accept",
            onClick: () => {
              if (resolve.isPending) return;
              resolve.mutate({ suggestionId: s.id, action: "accept" });
            },
          }}
          secondaryCta={{
            label: "Dismiss",
            onClick: () => {
              if (resolve.isPending) return;
              resolve.mutate({ suggestionId: s.id, action: "dismiss" });
            },
          }}
        />
      ))}

      {applied.length > 0 ? (
        <div className="flex flex-col gap-1 rounded-md bg-muted px-3 py-2">
          {applied.map((s) => (
            <div
              key={s.id}
              className="flex items-baseline gap-1.5 text-xs text-faint-foreground"
            >
              <Check className="size-3 shrink-0 translate-y-0.5 text-success" />
              <span>
                <span className="font-medium text-foreground">
                  {FIELD_LABEL[s.field]}
                </span>{" "}
                set automatically — {s.reasoning}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
