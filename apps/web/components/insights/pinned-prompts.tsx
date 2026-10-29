"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import { Loader2, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { relativeShort } from "@/components/home/editorial-section";
import { Gi } from "@/components/gr8r/icon";
import { G8Note } from "./g8-insights";
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
      <G8Note>
        Ask the numbers something below, then pin the question — it&apos;ll
        stay here and re-answer itself whenever the data moves.
      </G8Note>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-4 @3xl:grid-cols-2">
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
    <article
      className="ins-card group/prompt"
      style={{ flexDirection: "column", gap: 6 }}
    >
      <div className="flex w-full items-start justify-between gap-3">
        <h3 className="min-w-0">{card.prompt}</h3>
        <div className="row shrink-0 opacity-0 transition-opacity group-hover/prompt:opacity-100 group-focus-within/prompt:opacity-100" style={{ gap: 2 }}>
          <button
            type="button"
            className="ibtn ibtn-xs"
            aria-label="Re-answer now"
            title="Re-answer now"
            disabled={refresh.isPending}
            onClick={() => refresh.mutate()}
          >
            <Gi
              icon={RefreshCw}
              size={13}
              className={refresh.isPending ? "animate-spin" : undefined}
            />
          </button>
          <button
            type="button"
            className="ibtn ibtn-xs"
            aria-label="Unpin"
            title="Unpin"
            disabled={remove.isPending}
            onClick={() => remove.mutate()}
          >
            <Gi icon={Trash2} size={13} />
          </button>
        </div>
      </div>
      {card.answerMd ? (
        <div className="max-w-none text-[length:var(--g8-fs-sm)] leading-relaxed text-(--g8-text-2) [&_li]:my-0.5 [&_p]:my-1 [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4 [&_strong]:text-(--g8-text)">
          <ReactMarkdown>{card.answerMd}</ReactMarkdown>
        </div>
      ) : (
        <p className="row">
          <Gi icon={Loader2} size={13} className="animate-spin" />
          Answering…
        </p>
      )}
      {card.generatedAt ? (
        <span className="faint num" style={{ fontSize: "var(--g8-fs-xs)" }}>
          updated {relativeShort(card.generatedAt)} — re-answers when the
          numbers move
        </span>
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
