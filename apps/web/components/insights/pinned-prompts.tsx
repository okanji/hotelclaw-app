"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import { Loader2, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { relativeShort, WidgetEmpty } from "@/components/home/editorial-section";
import {
  insightsPromptsQueryOptions,
  type InsightPromptCard,
} from "@/lib/query/insights-queries";
import { scopeKey, type InsightScope } from "@/lib/insights/scope";

/**
 * Pinned questions — recurring prompts answered by the Q&A bot, each cached
 * against its lens's metrics fingerprint so a card re-generates only when
 * the numbers it reads move (the last-updated stamp is honest, not a timer).
 * Section content only — the sortable shell lives in the registry grid.
 */
export function PinnedPromptsBody({ propertyId }: { propertyId: string }) {
  const { data } = useQuery(insightsPromptsQueryOptions(propertyId));
  const prompts = data?.prompts ?? [];

  if (prompts.length === 0) {
    return (
      <WidgetEmpty>
        Ask the numbers something below, then pin the question — it&apos;ll
        stay here and re-answer itself whenever the data moves.
      </WidgetEmpty>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-x-10 gap-y-5 @3xl:grid-cols-2">
      {prompts.map((p) => (
        <PromptCard key={p.id} propertyId={propertyId} card={p} />
      ))}
    </div>
  );
}

function PromptCard({
  propertyId,
  card,
}: {
  propertyId: string;
  card: InsightPromptCard;
}) {
  const queryClient = useQueryClient();
  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: ["insights", propertyId, "prompts"],
    });

  const refresh = useMutation({
    mutationFn: async () => {
      const res = await fetch(
        `/api/properties/${propertyId}/insights/prompts/${card.id}`,
        { method: "POST" },
      );
      if (!res.ok) throw new Error("Couldn't refresh");
    },
    onSuccess: invalidate,
    onError: (e) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: async () => {
      const res = await fetch(
        `/api/properties/${propertyId}/insights/prompts/${card.id}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error("Couldn't unpin");
    },
    onSuccess: invalidate,
    onError: (e) => toast.error(e.message),
  });

  return (
    <article className="group/prompt flex flex-col gap-1.5">
      <div className="flex items-start justify-between gap-3">
        <h3 className="min-w-0 text-sm font-semibold tracking-tight text-pretty text-foreground">
          {card.prompt}
        </h3>
        <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover/prompt:opacity-100">
          <button
            type="button"
            aria-label="Re-answer now"
            title="Re-answer now"
            disabled={refresh.isPending}
            onClick={() => refresh.mutate()}
            className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <RefreshCw
              className={cn("size-3.5", refresh.isPending && "animate-spin")}
            />
          </button>
          <button
            type="button"
            aria-label="Unpin"
            title="Unpin"
            disabled={remove.isPending}
            onClick={() => remove.mutate()}
            className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </div>
      {card.answerMd ? (
        <div className="prose prose-sm dark:prose-invert max-w-none text-sm leading-relaxed text-muted-foreground [&_li]:my-0.5 [&_p]:my-1">
          <ReactMarkdown>{card.answerMd}</ReactMarkdown>
        </div>
      ) : (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          Answering…
        </p>
      )}
      {card.generatedAt ? (
        <p className="text-xs text-muted-foreground/70 tabular-nums">
          updated {relativeShort(card.generatedAt)} — re-answers when the
          numbers move
        </p>
      ) : null}
    </article>
  );
}

/** "Pin this question" — used by the ask dock after an answer lands. */
export function usePinPrompt(propertyId: string, scope: InsightScope) {
  const queryClient = useQueryClient();
  const [pinning, setPinning] = useState(false);

  async function pin(prompt: string) {
    setPinning(true);
    try {
      const res = await fetch(
        `/api/properties/${propertyId}/insights/prompts`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt, scope: scopeKey(scope) }),
        },
      );
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? "Couldn't pin the question");
      }
      await queryClient.invalidateQueries({
        queryKey: ["insights", propertyId, "prompts"],
      });
      toast.success("Pinned — it'll re-answer itself when the numbers move");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't pin");
    } finally {
      setPinning(false);
    }
  }

  return { pin, pinning } as const;
}
