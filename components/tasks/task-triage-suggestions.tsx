"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryOptions } from "@tanstack/react-query";
import { Check, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/**
 * Intake-triage suggestions on the task detail — the visible rung of the
 * trust ladder. Each row names the field, the value it would set, the bot's
 * confidence, and its one-line reasoning out in the open (not buried in a
 * tooltip), then accept applies the field / dismiss records the rejection.
 * Auto-applied fields drop to a quiet provenance line, so graduated autonomy
 * stays inspectable.
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
  low: "Low confidence",
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
    <div className="overflow-hidden rounded-lg border border-border/60 bg-muted/30">
      <div className="flex items-center gap-1.5 px-3 pt-2.5 pb-1.5 text-[0.6875rem] font-medium tracking-[0.08em] text-muted-foreground uppercase">
        <Sparkles className="size-3 shrink-0" />
        Suggested for this task
      </div>

      <div className="flex flex-col">
        {pending.map((s, i) => (
          <div
            key={s.id}
            className={cn(
              "flex items-start gap-2.5 px-3 py-2.5",
              i > 0 && "border-t border-border/60",
            )}
          >
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[0.8125rem]">
                <span className="text-muted-foreground">
                  Set {FIELD_LABEL[s.field]} to
                </span>
                <span className="font-semibold text-foreground">
                  {s.display_value}
                </span>
                <ConfidenceTag confidence={s.confidence} />
              </div>
              <p className="text-[0.75rem] leading-snug text-pretty text-muted-foreground">
                {s.reasoning}
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-1">
              <ActionButton
                tone="dismiss"
                label={`Dismiss ${FIELD_LABEL[s.field]} suggestion`}
                disabled={resolve.isPending}
                onClick={() =>
                  resolve.mutate({ suggestionId: s.id, action: "dismiss" })
                }
              >
                <X className="size-3.5 shrink-0" />
              </ActionButton>
              <ActionButton
                tone="accept"
                label={`Accept ${FIELD_LABEL[s.field]} suggestion`}
                disabled={resolve.isPending}
                onClick={() =>
                  resolve.mutate({ suggestionId: s.id, action: "accept" })
                }
              >
                <Check className="size-3.5 shrink-0" />
                Accept
              </ActionButton>
            </div>
          </div>
        ))}

        {applied.length > 0 ? (
          <div
            className={cn(
              "flex flex-col gap-1 bg-muted/40 px-3 py-2",
              pending.length > 0 && "border-t border-border/60",
            )}
          >
            {applied.map((s) => (
              <div
                key={s.id}
                className="flex items-baseline gap-1.5 text-[0.6875rem] text-muted-foreground"
              >
                <Check className="size-3 shrink-0 translate-y-0.5 text-emerald-600 dark:text-emerald-500" />
                <span>
                  <span className="font-medium text-foreground/80">
                    {FIELD_LABEL[s.field]}
                  </span>{" "}
                  set automatically — {s.reasoning}
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ConfidenceTag({
  confidence,
}: {
  confidence: Suggestion["confidence"];
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[0.625rem] font-medium",
        confidence === "high"
          ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
          : confidence === "medium"
            ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
            : "bg-muted text-muted-foreground",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-1.5 rounded-full",
          confidence === "high"
            ? "bg-emerald-500"
            : confidence === "medium"
              ? "bg-amber-500"
              : "bg-muted-foreground/50",
        )}
      />
      {CONFIDENCE_LABEL[confidence]}
    </span>
  );
}

function ActionButton({
  tone,
  label,
  disabled,
  onClick,
  children,
}: {
  tone: "accept" | "dismiss";
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "relative inline-flex h-7 items-center gap-1 rounded-md text-[0.75rem] font-medium transition-colors disabled:opacity-50",
        tone === "accept"
          ? "bg-emerald-500/10 px-2 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-400"
          : "px-1.5 text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {children}
      <span
        aria-hidden="true"
        className="absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-1/2 pointer-fine:hidden"
      />
    </button>
  );
}
