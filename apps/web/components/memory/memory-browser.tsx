"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Library, Pin, PinOff, Plus, Search, Sparkles, Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import type { MemoryRecord, MemorySubjectKind } from "@hotelclaw/memory";
import { PageHeader } from "@/components/shell/page-header";
import { Gi } from "@/components/gr8r/icon";
import { G8Badge } from "@/components/gr8r/ai-glyphs";
import { G8Empty } from "@/components/gr8r/members-shared";
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
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="page">
          <div className="ph">
            <div>
              <h1>Memory</h1>
              <p>What this property has learned — recalled by every bot, curated by owners and managers.</p>
            </div>
            {canCurate ? (
              <div className="acts">
                <button type="button" className="btn btn-primary btn-sm" onClick={() => setAdding((v) => !v)}>
                  <Gi icon={Plus} size={14} />
                  Add a fact
                </button>
              </div>
            ) : null}
          </div>

          <div className="stats">
            {(["property", "user", "guest"] as const).map((k) => (
              <button
                key={k}
                type="button"
                className="stat"
                onClick={() => setKind(k)}
                aria-pressed={kind === k}
              >
                <span className="k">{SUBJECT_LABEL[k]}</span>
                <span className="v">{counts[k]}</span>
              </button>
            ))}
            <button type="button" className="stat" onClick={() => setKind("all")} aria-pressed={kind === "all"}>
              <span className="k">Total remembered</span>
              <span className="v">{total}</span>
            </button>
          </div>

          {adding && canCurate ? (
            <form
              className="panel"
              style={{ marginTop: 20 }}
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
              <div className="panel-h">
                <h2>New property memory</h2>
              </div>
              <div className="panel-b flex flex-col gap-3">
                <textarea
                  className="textarea"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  rows={3}
                  maxLength={2000}
                  placeholder="One durable fact, specific and self-contained. e.g. The backup freezer is unit B2 behind the loading bay; it holds 48h without power."
                  autoFocus
                />
                <div className="row" style={{ flexWrap: "wrap", gap: 10 }}>
                  <label className="row muted" style={{ gap: 8, fontSize: "var(--g8-fs-sm)" }}>
                    <input
                      type="checkbox"
                      className="toggle"
                      checked={draftPinned}
                      onChange={(e) => setDraftPinned(e.target.checked)}
                    />
                    Pin — recall on every turn (standing facts only)
                  </label>
                  <span className="row" style={{ marginLeft: "auto", gap: 6 }}>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAdding(false)}>
                      Cancel
                    </button>
                    <button type="submit" className="btn btn-primary btn-sm" disabled={pending}>
                      Remember
                    </button>
                  </span>
                </div>
              </div>
            </form>
          ) : null}

          <div className="toolbar" style={{ marginTop: 24, padding: 0, border: 0, gap: 8 }}>
            <div className="inwrap grow" style={{ minWidth: 240 }}>
              <Gi icon={Search} size={14} />
              <input
                className="input"
                style={{ width: "100%" }}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search what the property remembers…"
                aria-label="Search memory"
              />
            </div>
            <div className="seg">
              {(["all", "property", "user", "guest"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  className={kind === k ? "on" : undefined}
                  aria-pressed={kind === k}
                >
                  {k === "all" ? "All" : SUBJECT_LABEL[k]}
                </button>
              ))}
            </div>
          </div>

          {listing.isError ? (
            <div className="alert danger" style={{ marginTop: 16 }}>
              <Gi icon={TriangleAlert} size={15} />
              <div>Could not load memory. Try again.</div>
            </div>
          ) : rows.length === 0 ? (
            <div className="panel" style={{ marginTop: 16 }}>
              <G8Empty
                icon={Library}
                title={debounced ? "No matches" : "Nothing remembered yet"}
                text={
                  debounced
                    ? `Nothing remembered matches “${debounced}”.`
                    : "Memories appear here as the AI saves findings during real work — a recurring issue and its fix, a supplier's behaviour, a decision and why — and as meetings, triage, and workflows record outcomes."
                }
              />
            </div>
          ) : (
            (["property", "user", "guest"] as const)
              .filter((k) => grouped[k].length > 0)
              .map((k) => (
                <section key={k} className="panel" style={{ marginTop: 16 }}>
                  <div className="panel-h" style={{ alignItems: "flex-start" }}>
                    <div style={{ minWidth: 0 }}>
                      <h2>
                        {SUBJECT_LABEL[k]}{" "}
                        <span className="faint" style={{ fontWeight: 500, fontSize: "var(--g8-fs-xs)" }}>
                          {grouped[k].length}
                        </span>
                      </h2>
                      <p className="muted" style={{ margin: "2px 0 0", fontSize: "var(--g8-fs-xs)", maxWidth: "70ch" }}>
                        {SUBJECT_HELP[k]}
                      </p>
                    </div>
                  </div>
                  <ul role="list" style={{ margin: 0, padding: 0, listStyle: "none" }}>
                    {grouped[k].map((row) => (
                      <li key={row.id} className="nrow" style={{ cursor: "default" }}>
                        <div className="min-w-0 flex-1">
                          <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
                            <G8Badge tone={KIND_TONE[row.kind]} dot={false}>{row.kind}</G8Badge>
                            {row.pinned ? (
                              <G8Badge tone="info" dot={false}>
                                pinned
                              </G8Badge>
                            ) : null}
                            <span className="mono faint" style={{ fontSize: "var(--g8-fs-2xs)" }}>
                              #{row.id.replace(/-/g, "").slice(0, 8)}
                            </span>
                            <span className="faint" style={{ fontSize: "var(--g8-fs-xs)", fontVariantNumeric: "tabular-nums" }}>
                              {row.created_at.slice(0, 10)}
                            </span>
                            {row.created_via !== "agent" ? (
                              <span className="faint" style={{ fontSize: "var(--g8-fs-xs)" }}>via {row.created_via}</span>
                            ) : null}
                            {row.tags.map((tag) => (
                              <span
                                key={tag}
                                className="badge"
                                style={{ height: 18, fontSize: "var(--g8-fs-2xs)" }}
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
                          <p style={{ margin: "6px 0 0", lineHeight: 1.5 }}>{row.content}</p>
                          {row.source ? (
                            <p className="faint" style={{ margin: "2px 0 0", fontSize: "var(--g8-fs-xs)" }}>
                              Source: {row.source}
                            </p>
                          ) : null}
                        </div>
                        {canCurate ? (
                          <div className="row" style={{ gap: 2, alignItems: "flex-start", flexShrink: 0 }}>
                            <button
                              type="button"
                              className={row.pinned ? "ibtn ibtn-sm on" : "ibtn ibtn-sm"}
                              aria-label={row.pinned ? "Unpin" : "Pin — recall every turn"}
                              title={row.pinned ? "Unpin" : "Pin — recall every turn"}
                              disabled={pending}
                              onClick={() =>
                                act(
                                  () => pinMemoryAction(propertyId, row.id, !row.pinned),
                                  row.pinned ? "Unpinned" : "Pinned — recalled every turn",
                                )
                              }
                            >
                              <Gi icon={row.pinned ? PinOff : Pin} size={14} />
                            </button>
                            <button
                              type="button"
                              className="ibtn ibtn-sm"
                              aria-label="Forget this memory"
                              title="Forget"
                              disabled={pending}
                              onClick={() => act(() => forgetMemoryAction(propertyId, row.id), "Forgotten")}
                            >
                              <Gi icon={Trash2} size={14} />
                            </button>
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </section>
              ))
          )}
        </div>
      </div>
    </div>
  );
}
