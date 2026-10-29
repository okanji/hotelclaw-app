"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRight,
  Loader2,
  Plus,
  RefreshCw,
  Workflow,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { RecommendationCard } from "@/components/ai/recommendation-card";
import { Gi } from "@/components/gr8r/icon";
import { Tog } from "@/components/gr8r/settings-ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getTrigger } from "@/lib/workflows/catalog";
import type { TriggerEventType } from "@/lib/workflows/spec";
import { workflowsListQueryOptions } from "@/lib/query/workflow-queries";
import {
  builderPrefillHref,
  featureMeta,
  featureRole,
  workflowTouchesFeature,
  type AutomationFeature,
} from "@/lib/workflows/features";

/**
 * The per-feature Automations modal — one answer to "what's already running
 * here, and what else could be?" without leaving the page you're on.
 *
 * Three bands, in the order the question actually gets asked:
 *   1. What's running on this feature (with its on/off switch, because the
 *      most common reason to open this is to turn something off).
 *   2. What the AI thinks you should add, grounded in this property.
 *   3. Build one from scratch.
 *
 * Nothing here constructs a spec. Both the suggestions and the blank "New
 * automation" button hand a plain-English goal to the existing author copilot
 * at /workflows/new, which owns catalog discovery and validation — so the user
 * always reviews a real spec before anything is saved.
 */

type SuggestionRow = {
  title: string;
  why: string;
  goal: string;
  /** Deterministic evidence lines this rests on, resolved server-side. */
  basis?: string[];
};

function suggestionsQueryOptions(propertyId: string, feature: AutomationFeature) {
  return queryOptions({
    queryKey: ["automation-suggestions", propertyId, feature] as const,
    // The server caches these for a day against a property fingerprint; the
    // client just needs to not re-ask on every modal open in one session.
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
    retry: false,
    queryFn: async (): Promise<SuggestionRow[]> => {
      const res = await fetch(`/api/properties/${propertyId}/workflows/suggestions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feature }),
      });
      if (!res.ok) throw new Error("Failed to load suggestions");
      const { suggestions } = (await res.json()) as { suggestions: SuggestionRow[] };
      return suggestions ?? [];
    },
  });
}

export function AutomationsDialog({
  propertyId,
  feature,
  open,
  onOpenChange,
}: {
  propertyId: string;
  feature: AutomationFeature;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const meta = featureMeta(feature);
  const queryClient = useQueryClient();
  const listOptions = workflowsListQueryOptions(propertyId);

  // Both queries are gated on `open` so a lightning button that's never
  // clicked costs nothing — no list fetch, and above all no model call.
  const { data: allWorkflows = [], isPending: listPending } = useQuery({
    ...listOptions,
    enabled: open,
  });
  const {
    data: suggestions = [],
    isPending: suggestPending,
    isFetching: suggestFetching,
    isError: suggestError,
  } = useQuery({ ...suggestionsQueryOptions(propertyId, feature), enabled: open });

  const matched = useMemo(
    () =>
      allWorkflows
        .filter((w) => workflowTouchesFeature(w, feature))
        .sort((a, b) => {
          // Triggers first — "starts here" is the stronger relationship — then
          // enabled before disabled, then alphabetical.
          const ra = featureRole(a, feature) === "trigger" ? 0 : 1;
          const rb = featureRole(b, feature) === "trigger" ? 0 : 1;
          if (ra !== rb) return ra - rb;
          if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
          return a.name.localeCompare(b.name);
        }),
    [allWorkflows, feature],
  );

  const [pending, setPending] = useState<Set<string>>(new Set());

  async function toggle(id: string, name: string, next: boolean) {
    if (pending.has(id)) return;
    setPending((p) => new Set(p).add(id));
    // Optimistic — the workflows list query is shared with the Workflows
    // section, so the switch stays consistent wherever it's rendered.
    queryClient.setQueryData(listOptions.queryKey, (old) =>
      old?.map((w) => (w.id === id ? { ...w, enabled: next } : w)),
    );
    try {
      const res = await fetch(`/api/properties/${propertyId}/workflows/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      if (!res.ok) throw new Error(await res.text());
    } catch {
      queryClient.setQueryData(listOptions.queryKey, (old) =>
        old?.map((w) => (w.id === id ? { ...w, enabled: !next } : w)),
      );
      toast.error(`Couldn't ${next ? "enable" : "disable"} "${name}"`);
    } finally {
      setPending((p) => {
        const n = new Set(p);
        n.delete(id);
        return n;
      });
    }
  }

  async function refreshSuggestions() {
    await queryClient.fetchQuery({
      ...suggestionsQueryOptions(propertyId, feature),
      queryFn: async () => {
        const res = await fetch(`/api/properties/${propertyId}/workflows/suggestions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ feature, refresh: true }),
        });
        if (!res.ok) throw new Error("Failed to load suggestions");
        const { suggestions: next } = (await res.json()) as {
          suggestions: SuggestionRow[];
        };
        return next ?? [];
      },
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Portaled out of the shell, so the popup carries `g8 g8-port` to
          get gr8r's classes (`.eyebrow`, `.panel`, `.nrow`, `.btn`…). */}
      <DialogContent className="g8 g8-port max-h-[85vh] gap-0 overflow-y-auto p-0 sm:max-w-lg">
        <DialogHeader className="px-5 pt-5 pb-4">
          <DialogTitle className="flex items-center gap-2">
            <span className="faint" style={{ display: "inline-flex" }}>
              <Gi icon={Zap} size={16} />
            </span>
            Automations · {meta.label}
          </DialogTitle>
          <DialogDescription>{meta.blurb}</DialogDescription>
        </DialogHeader>

        {/* ── Running here ─────────────────────────────────────────────── */}
        <section className="px-5 pb-5">
          <div className="eyebrow">
            {matched.length > 0 ? `Running on ${meta.label}` : `On ${meta.label}`}
          </div>
          <div style={{ marginTop: 8 }}>
            {listPending ? (
              <SkeletonRows />
            ) : matched.length === 0 ? (
              <div className="panel">
                <div className="empty-state sm">
                  <p style={{ margin: 0 }}>No automations touch {meta.label} yet.</p>
                </div>
              </div>
            ) : (
              <ul role="list" className="panel" style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {matched.map((w) => (
                  <li key={w.id} className="nrow" style={{ alignItems: "center", cursor: "default", padding: "8px 12px" }}>
                    <Link
                      href={`/p/${propertyId}/workflows/${w.id}`}
                      className="group row grow"
                      style={{ gap: 8 }}
                    >
                      <span className="faint" style={{ display: "inline-flex" }}>
                        <Gi icon={Workflow} />
                      </span>
                      <span className="col grow" style={{ gap: 1 }}>
                        <span className="row" style={{ gap: 6 }}>
                          <span
                            className="trunc"
                            style={{ fontWeight: 500, opacity: w.enabled ? 1 : 0.55 }}
                          >
                            {w.name}
                          </span>
                          <span className="faint opacity-0 transition-opacity group-hover:opacity-100" style={{ display: "inline-flex" }}>
                            <Gi icon={ArrowUpRight} size={12} />
                          </span>
                        </span>
                        <span className="trunc faint" style={{ fontSize: 12 }}>
                          {describeRelationship(w, feature)}
                        </span>
                      </span>
                    </Link>
                    <Tog
                      label={`${w.enabled ? "Disable" : "Enable"} ${w.name}`}
                      checked={w.enabled}
                      disabled={pending.has(w.id)}
                      onChange={(next) => void toggle(w.id, w.name, next)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* ── Suggested ────────────────────────────────────────────────── */}
        {/* Hidden entirely when AI is unconfigured or generation failed — an
            empty "Suggested" heading is worse than no heading. */}
        {suggestPending || suggestions.length > 0 ? (
          <section className="px-5 pb-5">
            <div className="row">
              <div className="eyebrow">Suggested for you</div>
              <span className="sp" />
              {suggestions.length > 0 ? (
                <button
                  type="button"
                  onClick={() => void refreshSuggestions()}
                  disabled={suggestFetching}
                  className="btn btn-ghost btn-sm"
                >
                  <Gi icon={RefreshCw} size={13} className={suggestFetching ? "animate-spin" : undefined} />
                  Refresh
                </button>
              ) : null}
            </div>
            <div className="stack" style={{ marginTop: 8, gap: 8 }}>
              {suggestPending ? (
                <SuggestionSkeleton />
              ) : (
                suggestions.map((s) => (
                  // Provenance in the "Why" disclosure: every basis line was
                  // resolved server-side from a deterministic signal the model
                  // cited, so it's measured fact — not the model's account of
                  // its own reasoning. "Build this" hands the goal to the
                  // author copilot, which owns catalog discovery + validation.
                  <RecommendationCard
                    key={s.title}
                    title={s.title}
                    description={s.why}
                    basis={s.basis}
                    primaryCta={{
                      label: "Build this",
                      href: builderPrefillHref(propertyId, s.goal, {
                        source: "automations-modal",
                        feature,
                      }),
                    }}
                  />
                ))
              )}
            </div>
          </section>
        ) : null}
        {suggestError ? (
          <p className="faint px-5 pb-5" style={{ fontSize: 12, margin: 0 }}>
            Couldn&apos;t load suggestions right now.
          </p>
        ) : null}

        {/* ── Build / browse ───────────────────────────────────────────── */}
        <footer className="modal-f">
          <Link href={`/p/${propertyId}/workflows`} className="btn btn-ghost btn-sm">
            All automations
          </Link>
          <span className="sp" />
          {/* NO ?prefill= here, deliberately. The builder auto-SENDS whatever
              goal it's handed, so seeding a feature stub ("Build an automation
              for a chat channel — ") fired the copilot on a half-sentence
              before the user had said what they wanted. A suggestion carries a
              complete "When X, do Y" and should auto-send; a blank start
              should land on the hero and let the user type. */}
          <Link href={`/p/${propertyId}/workflows/new`} className="btn btn-primary btn-sm">
            <Gi icon={Plus} size={14} />
            New automation
          </Link>
        </footer>
      </DialogContent>
    </Dialog>
  );
}

/** "Starts when a task is created" / "Posts to chat" — why this row is here. */
function describeRelationship(
  w: { trigger_event_type: string | null; step_types: string[] },
  feature: AutomationFeature,
): string {
  const role = featureRole(w, feature);
  const triggerLabel = w.trigger_event_type
    ? (getTrigger(w.trigger_event_type as TriggerEventType)?.label ??
      w.trigger_event_type)
    : null;
  if (role === "trigger" && triggerLabel) {
    // Trigger labels already read "When a task is created".
    return triggerLabel;
  }
  return triggerLabel
    ? `Acts on ${featureMeta(feature).label.toLowerCase()} · ${triggerLabel.toLowerCase()}`
    : `Acts on ${featureMeta(feature).label.toLowerCase()}`;
}

function SkeletonRows() {
  return (
    <div className="panel stack" style={{ padding: 12, gap: 10 }}>
      {[0, 1].map((i) => (
        <div key={i} className="row" style={{ gap: 8 }}>
          <span className="sk" style={{ width: 16, height: 16 }} />
          <span className="sk grow" style={{ height: 14 }} />
        </div>
      ))}
    </div>
  );
}

function SuggestionSkeleton() {
  return (
    <div className="row faint" style={{ gap: 8, padding: "14px 12px", fontSize: 12 }}>
      <Gi icon={Loader2} size={14} className="animate-spin" />
      Looking at what this property does…
    </div>
  );
}
