"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Pin, PinOff, Plus, Search, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { MemoryRecord, MemorySubjectKind } from "@hotelclaw/memory";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Eyebrow } from "@/components/ui/eyebrow";
import { PageShell } from "@/components/ui/page-shell";
import { PageHeader } from "@/components/shell/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";
import { forgetMemoryAction, pinMemoryAction, rememberMemoryAction } from "./actions";

type Counts = Record<MemorySubjectKind, number>;

const KIND_TONE: Record<MemoryRecord["kind"], "neutral" | "info" | "success" | "warning"> = {
  fact: "neutral",
  preference: "info",
  event: "neutral",
  outcome: "success",
  playbook: "warning",
};

const SUBJECT_LABEL: Record<MemorySubjectKind, string> = {
  property: "Property",
  user: "People",
  guest: "Guests",
};

const SUBJECT_HELP: Record<MemorySubjectKind, string> = {
  property:
    "Shared by every bot and member: recurring issues and fixes, supplier behaviour, decisions and why. Recalled at the top of every AI turn.",
  user: "Each person's own notes and preferences, recalled only in their conversations.",
  guest:
    "The guest-chatbot side channel — what guests shared, keyed by a hash of their contact details.",
};

/**
 * The Memory browser — what the property's AI actually remembers. Lists the
 * live `agent_memories` rows (the same store the eve memory provider recalls
 * from), searchable, with owner/manager curation: pin a standing fact so it
 * is recalled every turn, retire one that is wrong, add one by hand.
 */
export function MemoryBrowser({
  propertyId,
  initial,
  canCurate,
}: {
  propertyId: string;
  initial: { memories: MemoryRecord[]; counts: Counts };
  canCurate: boolean;
}) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<MemorySubjectKind | "all">("all");
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [draftPinned, setDraftPinned] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  const key = ["memory", propertyId, kind, debounced] as const;
  const listing = useQuery({
    queryKey: key,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (kind !== "all") params.set("kind", kind);
      if (debounced) params.set("q", debounced);
      const res = await fetch(`/api/properties/${propertyId}/memory?${params}`);
      if (!res.ok) throw new Error("Could not load memory");
      return (await res.json()) as { memories: MemoryRecord[]; counts: Counts };
    },
    initialData: kind === "all" && !debounced ? initial : undefined,
    staleTime: 10_000,
  });

  const rows = useMemo(() => listing.data?.memories ?? [], [listing.data]);
  const counts = listing.data?.counts ?? initial.counts;
  const total = counts.property + counts.user + counts.guest;

  const refresh = () => qc.invalidateQueries({ queryKey: ["memory", propertyId] });

  const act = (run: () => Promise<{ ok: true } | { error: string }>, done: string) =>
    startTransition(async () => {
      const result = await run();
      if ("error" in result) toast.error(result.error);
      else {
        toast.success(done);
        refresh();
      }
    });

  const grouped = useMemo(() => {
    const out: Record<MemorySubjectKind, MemoryRecord[]> = { property: [], user: [], guest: [] };
    for (const r of rows) out[r.subject_kind].push(r);
    return out;
  }, [rows]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        breadcrumbs={[
          { label: "Agents", href: `/p/${propertyId}/agents`, icon: <Sparkles /> },
          { label: "Memory" },
        ]}
        actions={
          canCurate ? (
            <Button variant="outline" size="sm" onClick={() => setAdding((v) => !v)}>
              <Plus data-icon="inline-start" />
              Add a fact
            </Button>
          ) : null
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto pt-4 pb-16">
        <PageShell className="flex flex-col">
          {/* Stat strip — plain numbers, no card chrome. */}
          <dl className="grid grid-cols-2 gap-y-6 sm:grid-cols-4">
            {(["property", "user", "guest"] as const).map((k) => (
              <div key={k} className="min-w-0">
                <dt className="truncate text-xs font-medium text-muted-foreground">{SUBJECT_LABEL[k]}</dt>
                <dd className="text-2xl font-semibold tabular-nums">{counts[k]}</dd>
              </div>
            ))}
            <div className="min-w-0">
              <dt className="truncate text-xs font-medium text-muted-foreground">Total remembered</dt>
              <dd className="text-2xl font-semibold tabular-nums">{total}</dd>
            </div>
          </dl>

          {adding && canCurate ? (
            <form
              className="mt-10 flex flex-col gap-3 rounded-lg p-4 shadow-ring"
              onSubmit={(e) => {
                e.preventDefault();
                const content = draft.trim();
                if (content.length < 8) {
                  toast.error("Write one specific fact (at least 8 characters).");
                  return;
                }
                act(
                  () => rememberMemoryAction(propertyId, { content, pinned: draftPinned }),
                  "Remembered",
                );
                setDraft("");
                setDraftPinned(false);
                setAdding(false);
              }}
            >
              <Eyebrow>New property memory</Eyebrow>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={3}
                maxLength={2000}
                placeholder="One durable fact, specific and self-contained. e.g. The backup freezer is unit B2 behind the loading bay; it holds 48h without power."
                className="w-full resize-y rounded-md bg-muted/40 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={draftPinned}
                    onChange={(e) => setDraftPinned(e.target.checked)}
                  />
                  Pin — recall on every turn (standing facts only)
                </label>
                <span className="ml-auto flex gap-2">
                  <Button type="button" variant="ghost" size="sm" onClick={() => setAdding(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" size="sm" disabled={pending}>
                    Remember
                  </Button>
                </span>
              </div>
            </form>
          ) : null}

          <div className="mt-10 flex flex-wrap items-center gap-2">
            <div className="relative min-w-[16rem] flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search what the property remembers…"
                className="pl-8"
              />
            </div>
            <div className="flex gap-1">
              {(["all", "property", "user", "guest"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  className={cn(
                    "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                    kind === k
                      ? "bg-foreground text-background"
                      : "bg-muted text-muted-foreground hover:text-foreground",
                  )}
                >
                  {k === "all" ? "All" : SUBJECT_LABEL[k]}
                </button>
              ))}
            </div>
          </div>

          {listing.isError ? (
            <p className="mt-6 text-sm text-destructive">Could not load memory. Try again.</p>
          ) : rows.length === 0 ? (
            <div className="mt-12 max-w-[52ch]">
              <p className="text-sm text-pretty text-muted-foreground">
                {debounced
                  ? `Nothing remembered matches “${debounced}”.`
                  : "Nothing remembered yet. Memories appear here as the AI saves findings during real work — a recurring issue and its fix, a supplier's behaviour, a decision and why — and as meetings, triage, and workflows record outcomes."}
              </p>
            </div>
          ) : (
            (["property", "user", "guest"] as const)
              .filter((k) => grouped[k].length > 0)
              .map((k) => (
                <section key={k} className="mt-12 flex flex-col gap-4">
                  <div>
                    <Eyebrow>{SUBJECT_LABEL[k]}</Eyebrow>
                    <p className="mt-1 max-w-[60ch] text-sm text-pretty text-muted-foreground">
                      {SUBJECT_HELP[k]}
                    </p>
                  </div>
                  <ul role="list" className="flex flex-col divide-y divide-border/60">
                    {grouped[k].map((row) => (
                      <li key={row.id} className="flex gap-4 py-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <StatusBadge tone={KIND_TONE[row.kind]}>{row.kind}</StatusBadge>
                            {row.pinned ? <StatusBadge tone="info">pinned</StatusBadge> : null}
                            <span className="font-mono text-[11px] text-muted-foreground">
                              #{row.id.replace(/-/g, "").slice(0, 8)}
                            </span>
                            <span className="text-xs text-muted-foreground tabular-nums">
                              {row.created_at.slice(0, 10)}
                            </span>
                            {row.created_via !== "agent" ? (
                              <span className="text-xs text-muted-foreground">via {row.created_via}</span>
                            ) : null}
                            {row.tags.map((tag) => (
                              <span
                                key={tag}
                                className="rounded-sm bg-muted px-1.5 py-px text-[11px] text-muted-foreground"
                                title={
                                  tag === "auto"
                                    ? "Learned automatically from a conversation; merged into clearer facts nightly"
                                    : tag === "feedback"
                                      ? "Distilled from a thumbs-down/up note"
                                      : tag === "consolidated"
                                        ? "Merged from several auto-captured memories"
                                        : undefined
                                }
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                          <p className="mt-1 text-sm text-pretty">{row.content}</p>
                          {row.source ? (
                            <p className="mt-0.5 text-xs text-muted-foreground">Source: {row.source}</p>
                          ) : null}
                        </div>
                        {canCurate ? (
                          <div className="flex shrink-0 items-start gap-1">
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={row.pinned ? "Unpin" : "Pin — recall every turn"}
                              disabled={pending}
                              onClick={() =>
                                act(
                                  () => pinMemoryAction(propertyId, row.id, !row.pinned),
                                  row.pinned ? "Unpinned" : "Pinned — recalled every turn",
                                )
                              }
                            >
                              {row.pinned ? <PinOff /> : <Pin />}
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label="Forget this memory"
                              disabled={pending}
                              onClick={() => act(() => forgetMemoryAction(propertyId, row.id), "Forgotten")}
                            >
                              <Trash2 />
                            </Button>
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </section>
              ))
          )}
        </PageShell>
      </div>
    </div>
  );
}
