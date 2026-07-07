"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { queryOptions } from "@tanstack/react-query";
import { Check, ChevronDown, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { CatchUpPayload } from "@/lib/insights/catch-up";

/**
 * "Since you last looked" — a quiet one-line banner at the top of a project
 * or space page. Renders nothing when nothing changed (most visits); when
 * the board moved it shows the AI's one-sentence read with the change
 * counts, expandable to the named highlights. "Mark read" advances the
 * per-user cursor. Counts and links come from the deterministic payload;
 * the model only wrote the sentence.
 */

type CatchUpRow = {
  payload: CatchUpPayload;
  summary_md: string | null;
  generated_at: string | null;
};

function catchUpQueryOptions(
  propertyId: string,
  subjectKind: "project" | "space",
  subjectId: string,
) {
  return queryOptions({
    queryKey: ["catch-up", propertyId, subjectKind, subjectId] as const,
    staleTime: 60_000,
    refetchInterval: (query) => (query.state.data?.pending ? 6_000 : false),
    queryFn: async (): Promise<{
      catchUp: CatchUpRow | null;
      pending: boolean;
    }> => {
      const res = await fetch(
        `/api/properties/${propertyId}/catch-up/${subjectKind}/${subjectId}`,
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error("Failed to load catch-up");
      return res.json();
    },
  });
}

export function CatchUpBanner({
  propertyId,
  subjectKind,
  subjectId,
}: {
  propertyId: string;
  subjectKind: "project" | "space";
  subjectId: string;
}) {
  const queryClient = useQueryClient();
  const { data } = useQuery(
    catchUpQueryOptions(propertyId, subjectKind, subjectId),
  );
  const [expanded, setExpanded] = useState(false);
  const [marking, setMarking] = useState(false);

  const payload = data?.catchUp?.payload;
  const summary = data?.catchUp?.summary_md;
  const total = payload
    ? payload.created + payload.completed + payload.blocked + payload.assignedToMe
    : 0;
  if (!payload || total === 0 || !summary) return null;

  async function markRead() {
    setMarking(true);
    try {
      const res = await fetch(
        `/api/properties/${propertyId}/catch-up/${subjectKind}/${subjectId}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "seen" }),
        },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await queryClient.invalidateQueries({
        queryKey: ["catch-up", propertyId, subjectKind, subjectId],
      });
    } catch {
      toast.error("Couldn't mark as read");
    } finally {
      setMarking(false);
    }
  }

  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 px-3.5 py-2.5">
      <div className="flex items-start gap-2.5">
        <Sparkles className="mt-0.5 size-3.5 shrink-0 text-foreground/50" />
        <div className="min-w-0 flex-1">
          <p className="text-sm leading-relaxed text-pretty text-foreground">
            {summary}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground tabular-nums">
            {payload.created > 0 ? <span>{payload.created} created</span> : null}
            {payload.completed > 0 ? (
              <span>{payload.completed} completed</span>
            ) : null}
            {payload.blocked > 0 ? <span>{payload.blocked} blocked</span> : null}
            {payload.assignedToMe > 0 ? (
              <span>{payload.assignedToMe} assigned to you</span>
            ) : null}
            {payload.highlights.length > 0 ? (
              <button
                type="button"
                onClick={() => setExpanded((e) => !e)}
                className="flex items-center gap-0.5 font-medium hover:text-foreground"
              >
                Details
                <ChevronDown
                  className={cn(
                    "size-3 transition-transform",
                    expanded && "rotate-180",
                  )}
                />
              </button>
            ) : null}
            <button
              type="button"
              disabled={marking}
              onClick={() => void markRead()}
              className="flex items-center gap-0.5 font-medium hover:text-foreground disabled:opacity-50"
            >
              <Check className="size-3" />
              Mark read
            </button>
          </div>
          {expanded ? (
            <ul className="mt-2 flex flex-col gap-0.5 border-t border-border/40 pt-2">
              {payload.highlights.map((h) => (
                <li key={`${h.taskId}-${h.what}`}>
                  <Link
                    href={`/p/${propertyId}/tasks/${h.taskId}`}
                    className="group flex items-baseline gap-2 text-xs"
                  >
                    <span className="min-w-0 truncate text-foreground group-hover:underline">
                      {h.title}
                    </span>
                    <span className="shrink-0 text-muted-foreground">
                      {h.what}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </div>
  );
}
