"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRight,
  ChevronRight,
  Loader2,
  Plus,
  RefreshCw,
  Sparkles,
  Workflow,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Switch } from "@/components/ui/switch";
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
import { cn } from "@/lib/utils";

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
  // Which suggestion is showing its full builder prompt (title = key; one at a
  // time keeps the modal from growing past its scroll on a 4-suggestion set).
  const [openPrompt, setOpenPrompt] = useState<string | null>(null);

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
      <DialogContent className="max-h-[85vh] gap-0 overflow-y-auto p-0 sm:max-w-lg">
        <DialogHeader className="px-5 pt-5 pb-4">
          <DialogTitle className="flex items-center gap-2">
            <Zap className="size-4 text-muted-foreground" aria-hidden />
            Automations · {meta.label}
          </DialogTitle>
          <DialogDescription>{meta.blurb}</DialogDescription>
        </DialogHeader>

        {/* ── Running here ─────────────────────────────────────────────── */}
        <section className="px-5 pb-5">
          <Eyebrow>
            {matched.length > 0 ? `Running on ${meta.label}` : `On ${meta.label}`}
          </Eyebrow>
          <div className="mt-2">
            {listPending ? (
              <SkeletonRows />
            ) : matched.length === 0 ? (
              <p className="rounded-md bg-muted px-4 py-6 text-center text-sm text-muted-foreground">
                No automations touch {meta.label} yet.
              </p>
            ) : (
              <ul role="list" className="flex flex-col divide-y divide-border rounded-md bg-muted">
                {matched.map((w) => (
                  <li key={w.id} className="flex items-center gap-2 px-3 py-2">
                    <Link
                      href={`/p/${propertyId}/workflows/${w.id}`}
                      className="group flex min-w-0 flex-1 items-center gap-2"
                    >
                      <Workflow
                        className="size-4 shrink-0 text-muted-foreground"
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span
                            className={cn(
                              "truncate text-sm font-medium text-foreground",
                              !w.enabled && "opacity-55",
                            )}
                          >
                            {w.name}
                          </span>
                          <ArrowUpRight className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                        </span>
                        <span className="block truncate text-xs text-faint-foreground">
                          {describeRelationship(w, feature)}
                        </span>
                      </span>
                    </Link>
                    <Switch
                      checked={w.enabled}
                      disabled={pending.has(w.id)}
                      aria-label={`${w.enabled ? "Disable" : "Enable"} ${w.name}`}
                      onCheckedChange={(next) => void toggle(w.id, w.name, next)}
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
            <div className="flex items-center justify-between gap-2">
              <Eyebrow>Suggested for you</Eyebrow>
              {suggestions.length > 0 ? (
                <button
                  type="button"
                  onClick={() => void refreshSuggestions()}
                  disabled={suggestFetching}
                  className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
                >
                  <RefreshCw
                    className={cn("size-3", suggestFetching && "animate-spin")}
                    aria-hidden
                  />
                  Refresh
                </button>
              ) : null}
            </div>
            <div className="mt-2 flex flex-col gap-1.5">
              {suggestPending ? (
                <SuggestionSkeleton />
              ) : (
                suggestions.map((s) => {
                  const shown = openPrompt === s.title;
                  return (
                    <div
                      key={s.title}
                      className="rounded-md px-3 py-2.5 transition-colors hover:bg-accent"
                    >
                      <div className="flex items-start gap-2.5">
                        <Sparkles
                          className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
                          aria-hidden
                        />
                        <div className="min-w-0 flex-1">
                          {/* The title/blurb is the click target. The prompt
                              toggle CANNOT live inside it — a <button> nested
                              in an <a> is invalid and breaks keyboard nav. */}
                          <Link
                            href={builderPrefillHref(propertyId, s.goal, {
                              source: "automations-modal",
                              feature,
                            })}
                            className="group block text-left"
                          >
                            <span className="flex items-center gap-1.5">
                              <span className="text-sm font-medium text-foreground">
                                {s.title}
                              </span>
                              <span className="shrink-0 text-xs text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
                                Build →
                              </span>
                            </span>
                            <span className="block text-xs leading-relaxed text-muted-foreground">
                              {s.why}
                            </span>
                          </Link>
                          <button
                            type="button"
                            aria-expanded={shown}
                            onClick={() => setOpenPrompt(shown ? null : s.title)}
                            className="mt-1.5 inline-flex items-center gap-1 rounded-md text-xs text-muted-foreground transition-colors hover:text-foreground"
                          >
                            <ChevronRight
                              aria-hidden
                              className={cn(
                                "size-3 transition-transform",
                                shown && "rotate-90",
                              )}
                            />
                            {shown ? "Hide prompt" : "Show prompt"}
                          </button>
                          {shown ? (
                            <div className="mt-1.5 flex flex-col gap-2 rounded-md bg-muted px-2.5 py-2">
                              <div>
                                <Eyebrow>Prompt sent to the builder</Eyebrow>
                                <p className="mt-1 text-xs leading-relaxed text-foreground">
                                  {s.goal}
                                </p>
                              </div>
                              {/* Provenance. Every line here was resolved
                                  server-side from a deterministic signal the
                                  model cited, so it's measured fact — not the
                                  model's account of its own reasoning. */}
                              {s.basis && s.basis.length > 0 ? (
                                <div>
                                  <Eyebrow>Suggested because</Eyebrow>
                                  <ul className="mt-1 flex flex-col gap-0.5">
                                    {s.basis.map((b) => (
                                      <li
                                        key={b}
                                        className="text-xs leading-relaxed text-muted-foreground"
                                      >
                                        · {b}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              ) : null}
                              <p className="text-xs leading-relaxed text-faint-foreground">
                                Building sends the prompt to the workflow
                                builder, which picks the trigger and steps. You
                                review the result before anything saves.
                              </p>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </section>
        ) : null}
        {suggestError ? (
          <p className="px-5 pb-5 text-xs text-muted-foreground">
            Couldn&apos;t load suggestions right now.
          </p>
        ) : null}

        {/* ── Build / browse ───────────────────────────────────────────── */}
        <footer className="flex items-center justify-between gap-2 px-5 pt-1 pb-5">
          <Link
            href={`/p/${propertyId}/workflows`}
            className="text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            All automations
          </Link>
          <Button
            size="sm"
            // Renders an <a>, so Base UI's native-button assertion has to be
            // waived — the house convention for every Button+Link call site.
            nativeButton={false}
            // NO ?prefill= here, deliberately. The builder auto-SENDS whatever
            // goal it's handed, so seeding a feature stub ("Build an automation
            // for a chat channel — ") fired the copilot on a half-sentence
            // before the user had said what they wanted. A suggestion carries a
            // complete "When X, do Y" and should auto-send; a blank start
            // should land on the hero and let the user type.
            render={<Link href={`/p/${propertyId}/workflows/new`} />}
          >
            <Plus data-slot="icon" />
            New automation
          </Button>
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
    <div className="flex flex-col gap-px rounded-md bg-muted p-3">
      {[0, 1].map((i) => (
        <div key={i} className="flex items-center gap-2 py-1.5">
          <div className="size-4 shrink-0 animate-pulse rounded-md bg-border" />
          <div className="h-3.5 flex-1 animate-pulse rounded-md bg-border" />
        </div>
      ))}
    </div>
  );
}

function SuggestionSkeleton() {
  return (
    <div className="flex items-center gap-2 px-3 py-4 text-xs text-muted-foreground">
      <Loader2 className="size-3.5 animate-spin" aria-hidden />
      Looking at what this property does…
    </div>
  );
}
