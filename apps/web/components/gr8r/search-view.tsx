"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDownUp,
  FileText,
  FolderKanban,
  Hash,
  History,
  MessageSquare,
  Paperclip,
  Search,
  SearchX,
  X,
} from "lucide-react";
import type { MessageResponse } from "stream-chat";
import { PageHeader } from "@/components/shell/page-header";
import { Gi } from "@/components/gr8r/icon";
import { Av, G8_COLOR, PStatus, StIcon, type AvMember } from "@/components/gr8r/home-glyphs";
import { ago } from "@/components/gr8r/inbox-shared";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useConnectedStreamClient, useStreamConnection } from "@/lib/stream/client-provider";
import { useOpenChannel } from "@/lib/chat/use-open-channel";
import { useOpenDocument } from "@/lib/documents/use-open-document";
import { useOpenProject } from "@/lib/projects/use-open-project";
import { lastSectionPath } from "@/lib/shell/last-path";
import { propertyMembersQueryOptions, tasksQueryOptions } from "@/lib/query/section-queries";
import { projectsTrackingQueryOptions } from "@/lib/query/project-queries";
import type { DocumentSearchHit } from "@/lib/documents/search";
import { taskHref } from "@/lib/tasks/task-href";
import { taskKey } from "@/lib/tasks/task-key";
import { PROJECT_STATUS_META } from "@/components/projects/tracking/tracking-shared";
import { highlight } from "@/components/chat/search/highlight";
import { SearchFilterChips } from "@/components/chat/search/search-filter-chips";
import {
  parseSearchParams,
  stringifySearchState,
  type SearchState,
} from "@/components/chat/search/parse-search-params";
import { useMessageSearch } from "@/components/chat/search/use-message-search";

/**
 * gr8r-studio's `pageSearch` (src/pages/search.js) over our search: one big
 * input, category tabs with counts, and a section per kind — Tasks (the tasks
 * cache, title / key / description), Projects, Documents (the keyword RPC via
 * `/documents/search`, body text + preview), People (opens a DM) and Messages
 * (Stream search, with the from: / in: / before: / after: / has: chips, sort
 * and infinite scroll we had). Empty query shows recent searches (per device).
 * State lives in the URL (`?q=` + the message filters) as before; Esc exits.
 */

type CSSVars = CSSProperties & Record<`--${string}`, string | number>;
type Cat = "all" | "tasks" | "projects" | "docs" | "people" | "messages";

const CATS: [Cat, string][] = [
  ["all", "All"],
  ["tasks", "Tasks"],
  ["projects", "Projects"],
  ["docs", "Documents"],
  ["people", "People"],
  ["messages", "Messages"],
];
/** Rows per section on the All tab — a category tab shows everything. */
const ALL_CAP = 6;

/* Recent searches — a per-device convenience, never load-bearing. */
const RECENT_KEY = "hotelclaw:recent-searches";
function readRecent(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    return raw ? (JSON.parse(raw) as string[]).slice(0, 8) : [];
  } catch {
    return [];
  }
}
function pushRecent(term: string): string[] {
  const t = term.trim();
  if (t.length < 2) return readRecent();
  const next = [t, ...readRecent().filter((x) => x.toLowerCase() !== t.toLowerCase())].slice(0, 8);
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Preference only.
  }
  return next;
}

function stripHtml(s: string | null | undefined): string {
  return (s ?? "").replace(/<[^>]+>/g, " ");
}

export function SearchView({ propertyId }: { propertyId: string }) {
  const router = useRouter();
  const urlParams = useSearchParams();
  const client = useConnectedStreamClient();
  const { status: streamStatus } = useStreamConnection();
  const openChannel = useOpenChannel(propertyId);
  const openDocument = useOpenDocument(propertyId);
  const openProject = useOpenProject(propertyId);

  const urlState = useMemo<SearchState>(
    () => parseSearchParams(urlParams ?? new URLSearchParams()),
    [urlParams],
  );
  const [cat, setCat] = useState<Cat>(() => {
    const c = urlParams?.get("cat");
    return CATS.some(([k]) => k === c) ? (c as Cat) : "all";
  });
  const [draft, setDraft] = useState(urlState.q);
  const debounced = useDebouncedValue(draft, 300);
  const [recent, setRecent] = useState<string[]>([]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRecent(readRecent());
  }, []);

  // Adopt an external URL change of `q` (e.g. back/forward).
  useEffect(() => {
    if (urlState.q !== draft && urlState.q !== debounced) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDraft(urlState.q);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlState.q]);

  const urlFor = useCallback(
    (state: SearchState, c: Cat) => {
      const qs = stringifySearchState(state);
      const params = new URLSearchParams(qs.slice(1));
      if (c !== "all") params.set("cat", c);
      const s = params.toString();
      return `/p/${propertyId}/search${s ? `?${s}` : ""}`;
    },
    [propertyId],
  );
  const lastPushed = useRef(urlFor(urlState, cat));
  useEffect(() => {
    if (debounced === urlState.q) return;
    const href = urlFor({ ...urlState, q: debounced }, cat);
    if (href === lastPushed.current) return;
    lastPushed.current = href;
    router.replace(href, { scroll: false });
  }, [debounced, urlState, router, urlFor, cat]);

  const patchState = useCallback(
    (patch: Partial<SearchState>) => {
      const href = urlFor({ ...urlState, ...patch }, cat);
      lastPushed.current = href;
      router.replace(href, { scroll: false });
    },
    [urlState, router, urlFor, cat],
  );
  function changeCat(c: Cat) {
    setCat(c);
    const href = urlFor({ ...urlState, q: debounced }, c);
    lastPushed.current = href;
    router.replace(href, { scroll: false });
  }
  function setQuery(q: string) {
    setDraft(q);
    if (q) setRecent(pushRecent(q));
  }

  const exit = useCallback(() => {
    if (window.history.length > 1) router.back();
    else router.push(lastSectionPath(propertyId, "chat") ?? `/p/${propertyId}/chat`);
  }, [router, propertyId]);
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("[data-slot='popover-content']")) return;
      e.preventDefault();
      exit();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [exit]);

  const term = debounced.trim();
  const lower = term.toLowerCase();
  const has = (s: string | null | undefined) => !!s && s.toLowerCase().includes(lower);
  const remember = () => setRecent(pushRecent(term));

  /* ── Sources ── */
  const { data: tasks = [] } = useQuery(tasksQueryOptions(propertyId));
  const { data: projects = [] } = useQuery(projectsTrackingQueryOptions(propertyId));
  const { data: members = [] } = useQuery(propertyMembersQueryOptions(propertyId));
  const { data: docHits = [], isFetching: docsLoading } = useQuery<DocumentSearchHit[]>({
    queryKey: ["search-page", "docs", propertyId, term],
    enabled: term.length >= 2,
    queryFn: async () => {
      const r = await fetch(
        `/api/properties/${propertyId}/documents/search?q=${encodeURIComponent(term)}&limit=30`,
        { cache: "no-store" },
      );
      if (!r.ok) return [];
      const body = (await r.json()) as { results?: DocumentSearchHit[] };
      return body.results ?? [];
    },
  });
  const msgState: SearchState = { ...urlState, q: term };
  const search = useMessageSearch({ propertyId, state: msgState, enabled: term.length >= 2 && !!client });
  const msgHits = useMemo(() => (search.data?.pages ?? []).flatMap((p) => p.hits), [search.data]);

  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const memberById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  const toAv = (id: string | null | undefined): AvMember | null => {
    const m = id ? memberById.get(id) : undefined;
    return m ? { id: m.id, name: m.name, avatarUrl: m.avatarUrl } : null;
  };

  const r = (() => {
    if (!lower) return { tasks: [], projects: [], people: [] };
    const hit = (s: string | null | undefined) => !!s && s.toLowerCase().includes(lower);
    return {
      tasks: tasks
        .filter((t) => hit(t.title) || hit(t.key) || hit(stripHtml(t.description)))
        .slice(0, 50),
      projects: projects.filter((p) => hit(p.name) || hit(p.description)),
      people: members.filter((m) => hit(m.name) || hit(m.email)),
    };
  })();

  const counts: Record<Cat, number> = {
    tasks: r.tasks.length,
    projects: r.projects.length,
    docs: docHits.length,
    people: r.people.length,
    messages: msgHits.length,
    all: 0,
  };
  counts.all = counts.tasks + counts.projects + counts.docs + counts.people + counts.messages;
  const msgMore = search.hasNextPage;

  async function openDm(userId: string) {
    if (!client?.user?.id || userId === client.user.id) return;
    try {
      const channel = client.channel("messaging", undefined, {
        members: [client.user.id, userId],
        property_id: propertyId,
      } as Record<string, unknown>);
      await channel.create();
      if (channel.id) openChannel("messaging", channel.id);
    } catch (e) {
      console.error("openDm failed", e);
    }
  }

  /* Infinite scroll for the Messages tab. */
  const sentinel = useRef<HTMLDivElement | null>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = search;
  useEffect(() => {
    const node = sentinel.current;
    if (cat !== "messages" || !node || !hasNextPage || isFetchingNextPage) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void fetchNextPage();
      },
      { rootMargin: "200px" },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [cat, hasNextPage, isFetchingNextPage, fetchNextPage]);

  const cap = <T,>(rows: T[]) => (cat === "all" ? rows.slice(0, ALL_CAP) : rows);
  const show = (k: Cat) => cat === "all" || cat === k;
  const messageFiltersOn = !!(urlState.in || urlState.from || urlState.before || urlState.after || urlState.has);

  const searchingRemote = term.length >= 2 && (docsLoading || search.isLoading);
  const nothing = !!term && counts.all === 0 && !searchingRemote;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="Search"
        icon={<Search />}
        actions={
          <button
            type="button"
            className="ibtn"
            onClick={exit}
            title="Exit search (Esc)"
            aria-label="Exit search"
          >
            <Gi icon={X} size={16} />
          </button>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="page" style={{ maxWidth: 860 }}>
          <div className="inwrap" style={{ marginBottom: 14 }}>
            <Gi icon={Search} size={16} />
            <input
              autoFocus
              className="input input-lg"
              placeholder="Search tasks, projects, documents, people, and messages"
              aria-label="Search"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") setRecent(pushRecent(draft));
              }}
              style={{ paddingLeft: 34, fontSize: 15 }}
            />
          </div>
          <div className="tabs" style={{ marginBottom: 18 }} role="tablist" aria-label="Category">
            {CATS.map(([k, n]) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={cat === k}
                className={`tab ${cat === k ? "on" : ""}`}
                onClick={() => changeCat(k)}
              >
                {n}
                <span className="cnt">
                  {counts[k]}
                  {(k === "messages" || k === "all") && msgMore ? "+" : ""}
                </span>
              </button>
            ))}
          </div>

          {cat === "messages" || messageFiltersOn ? (
            <div className="row" style={{ marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
              <SearchFilterChips propertyId={propertyId} state={urlState} onChange={patchState} />
              <span className="sp" />
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                title={`Messages: ${urlState.sort === "newest" ? "newest first" : "oldest first"}`}
                onClick={() => patchState({ sort: urlState.sort === "newest" ? "oldest" : "newest" })}
              >
                <Gi icon={ArrowDownUp} size={13} />
                {urlState.sort === "newest" ? "Newest" : "Oldest"}
              </button>
            </div>
          ) : null}

          {!term ? (
            recent.length ? (
              <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                <span className="faint" style={{ fontSize: 12.5 }}>
                  Recent:
                </span>
                {recent.map((s) => (
                  <button key={s} type="button" className="badge" onClick={() => setQuery(s)}>
                    <Gi icon={History} size={11} />
                    {s}
                  </button>
                ))}
              </div>
            ) : (
              <div className="panel">
                <div className="empty-state">
                  <div className="glyph">
                    <Gi icon={Search} size={20} />
                  </div>
                  <h2 className="es-h">Search everything</h2>
                  <p>
                    Tasks, projects, documents, people, and messages in channels and DMs you&apos;re a
                    member of.
                  </p>
                </div>
              </div>
            )
          ) : nothing ? (
            <div className="panel">
              <div className="empty-state">
                <div className="glyph">
                  <Gi icon={SearchX} size={20} />
                </div>
                <h2 className="es-h">No results found</h2>
                <p>
                  Nothing matches “{term}”. Check the spelling, try a broader term
                  {messageFiltersOn ? ", or remove the message filters" : ""}.
                </p>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDraft("")}>
                  Clear search
                </button>
              </div>
            </div>
          ) : (
            <>
              <Section cat={cat} msgMore={!!msgMore} onSeeAll={changeCat} k="tasks" title="Tasks" count={counts.tasks}>
                {cap(r.tasks).map((t) => {
                  const p = t.project_id ? projectById.get(t.project_id) : undefined;
                  return (
                    <Link
                      key={t.id}
                      className="mini"
                      href={taskHref(propertyId, t.id)}
                      onClick={remember}
                    >
                      <StIcon task={t} />
                      <span className="mono faint" style={{ fontSize: 11 }}>
                        {taskKey(t)}
                      </span>
                      <span className="tt">{highlight(t.title, term)}</span>
                      {p || t.project_name ? (
                        <span className="pj hide-m">
                          <span
                            className="pdot"
                            style={{ "--g8-c": p ? G8_COLOR[p.color] : "var(--g8-gray)" } as CSSVars}
                          />
                          <span className="trunc">{p?.name ?? t.project_name}</span>
                        </span>
                      ) : null}
                      <Av member={toAv(t.assignee_id)} />
                    </Link>
                  );
                })}
              </Section>

              <Section cat={cat} msgMore={!!msgMore} onSeeAll={changeCat} k="projects" title="Projects" count={counts.projects}>
                {cap(r.projects).map((p) => (
                  <div
                    key={p.id}
                    className="mini"
                    role="link"
                    tabIndex={0}
                    onClick={() => {
                      remember();
                      openProject(p.id);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") openProject(p.id);
                    }}
                  >
                    <span
                      className="picon"
                      style={{ "--g8-c": G8_COLOR[p.color], "--g8-sz": "20px", fontSize: 11 } as CSSVars}
                    >
                      {p.icon ? p.icon : <Gi icon={FolderKanban} size={12} />}
                    </span>
                    <span className="tt">
                      {highlight(p.name, term)}
                      {p.description ? (
                        <span className="faint" style={{ fontSize: 12 }}>
                          {" "}
                          — {p.description.slice(0, 70)}
                          {p.description.length > 70 ? "…" : ""}
                        </span>
                      ) : null}
                    </span>
                    <PStatus
                      name={PROJECT_STATUS_META[p.status].label}
                      color={
                        p.status === "active"
                          ? "var(--g8-blue)"
                          : p.status === "completed"
                            ? "var(--g8-green)"
                            : "var(--g8-gray)"
                      }
                    />
                  </div>
                ))}
              </Section>

              <Section cat={cat} msgMore={!!msgMore} onSeeAll={changeCat} k="docs" title="Documents" count={counts.docs}>
                {cap(docHits).map((d) => (
                  <div
                    key={d.id}
                    className="mini"
                    role="link"
                    tabIndex={0}
                    style={{ alignItems: "flex-start", paddingTop: 10, paddingBottom: 10 }}
                    onClick={() => {
                      remember();
                      openDocument(d.id);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") openDocument(d.id);
                    }}
                  >
                    <span className="faint" style={{ display: "inline-flex", paddingTop: 2 }}>
                      <Gi icon={FileText} size={14} />
                    </span>
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div className="row" style={{ gap: 8 }}>
                        <span className="trunc" style={{ fontWeight: 500 }}>
                          {highlight(d.title || "Untitled", term)}
                        </span>
                        <span className="sp" />
                        <span className="faint" style={{ fontSize: 12, whiteSpace: "nowrap" }}>
                          {ago(d.updated_at)}
                        </span>
                      </div>
                      {d.preview ? (
                        <div className="muted trunc" style={{ fontSize: 12.5 }}>
                          {highlight(d.preview, term)}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ))}
              </Section>

              <Section cat={cat} msgMore={!!msgMore} onSeeAll={changeCat} k="people" title="People" count={counts.people}>
                {cap(r.people).map((m) => (
                  <div
                    key={m.id}
                    className="mini"
                    role="button"
                    tabIndex={0}
                    title={client ? "Message" : undefined}
                    onClick={() => {
                      remember();
                      void openDm(m.id);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void openDm(m.id);
                    }}
                  >
                    <Av member={{ id: m.id, name: m.name, avatarUrl: m.avatarUrl }} size="md" />
                    <span className="tt">
                      {highlight(m.name ?? "Member", term)}{" "}
                      <span className="faint" style={{ fontSize: 12, textTransform: "capitalize" }}>
                        {m.role}
                      </span>
                    </span>
                    {m.email ? (
                      <span className="faint hide-m" style={{ fontSize: 12 }}>
                        {has(m.email) ? highlight(m.email, term) : m.email}
                      </span>
                    ) : null}
                  </div>
                ))}
              </Section>

              {show("messages") && !client ? (
                <div className="panel" style={{ marginBottom: 22 }}>
                  <div className="empty-state sm">
                    <p>
                      {streamStatus === "error"
                        ? "Couldn't connect to chat — messages can't be searched right now."
                        : "Connecting to chat…"}
                    </p>
                  </div>
                </div>
              ) : null}
              {show("messages") && search.isError ? (
                <div className="panel" style={{ marginBottom: 22 }}>
                  <div className="empty-state sm">
                    <p>{search.error?.message ?? "Message search failed."}</p>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => void search.refetch()}
                    >
                      Try again
                    </button>
                  </div>
                </div>
              ) : null}
              <Section cat={cat} msgMore={!!msgMore} onSeeAll={changeCat} k="messages" title="Messages" count={counts.messages}>
                {cap(msgHits).map((hit) => (
                  <MessageRow
                    key={`${hit.message.cid}:${hit.message.id}`}
                    message={hit.message}
                    query={term}
                    onOpen={() => {
                      remember();
                      const meta = (hit.message as { channel?: { type?: string } }).channel;
                      if (hit.channelId)
                        openChannel(meta?.type, hit.channelId, { messageId: hit.message.id });
                    }}
                  />
                ))}
              </Section>
              {cat === "messages" && msgHits.length ? (
                hasNextPage ? (
                  <div ref={sentinel} className="row" style={{ justifyContent: "center", padding: 12 }}>
                    {isFetchingNextPage ? (
                      <span className="faint" style={{ fontSize: 12 }}>
                        Loading more…
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => void fetchNextPage()}
                      >
                        Load more
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="faint" style={{ textAlign: "center", fontSize: 12, padding: 12 }}>
                    End of results
                  </div>
                )
              ) : null}
              {searchingRemote ? (
                <div className="faint" style={{ fontSize: 12, padding: "4px 2px" }}>
                  Searching…
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({
  cat,
  msgMore,
  onSeeAll,
  k,
  title,
  count,
  children,
}: {
  cat: Cat;
  msgMore: boolean;
  onSeeAll: (k: Cat) => void;
  k: Cat;
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  if (!(cat === "all" || cat === k) || !count) return null;
  return (
    <section style={{ marginBottom: 22 }}>
      <div className="row" style={{ marginBottom: 6 }}>
        <span className="eyebrow">
          {title} · {count}
          {k === "messages" && msgMore ? "+" : ""}
        </span>
        <span className="sp" />
        {cat === "all" && count > ALL_CAP ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onSeeAll(k)}>
            See all
          </button>
        ) : null}
      </div>
      <div className="panel" style={{ overflow: "hidden" }}>
        {children}
      </div>
    </section>
  );
}

/**
 * gr8r search rows show a short excerpt, not the whole message: collapse
 * whitespace, and when the first match sits deep in a long message start the
 * excerpt a little before it (on a word boundary, with a leading "…") so the
 * highlighted term lands inside the 3-line clamp.
 */
function messageSnippet(text: string, query: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= 220) return flat;
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const lower = flat.toLowerCase();
  let first = -1;
  for (const t of terms) {
    const i = lower.indexOf(t);
    if (i !== -1 && (first === -1 || i < first)) first = i;
  }
  if (first < 100) return flat;
  let start = first - 60;
  const space = flat.indexOf(" ", start);
  if (space !== -1 && space < first) start = space + 1;
  return `…${flat.slice(start)}`;
}

/** gr8r's comment row shape, for a Stream message hit. */
function MessageRow({
  message,
  query,
  onOpen,
}: {
  message: MessageResponse;
  query: string;
  onOpen: () => void;
}) {
  const sender = message.user?.name ?? message.user?.id ?? "Someone";
  const meta = (message as { channel?: { name?: string; id?: string; type?: string } }).channel;
  const isDm = meta?.type === "messaging";
  const channelLabel = meta?.name ?? meta?.id ?? "channel";
  const attachments = message.attachments?.length ?? 0;
  return (
    <div
      className="mini"
      role="link"
      tabIndex={0}
      style={{ alignItems: "flex-start", paddingTop: 10, paddingBottom: 10 }}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter") onOpen();
      }}
    >
      <Av
        member={{
          id: message.user?.id ?? sender,
          name: sender,
          avatarUrl: (message.user?.image as string | undefined) ?? null,
        }}
      />
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="muted row" style={{ fontSize: 12, gap: 4 }}>
          <b style={{ color: "var(--g8-text)", fontWeight: 500 }}>{sender}</b>
          <span>in</span>
          <Gi icon={isDm ? MessageSquare : Hash} size={11} />
          <span className="trunc">{channelLabel}</span>
          {message.created_at ? <span>· {ago(String(message.created_at))}</span> : null}
        </div>
        {message.text ? (
          <div className="g8-snip">{highlight(messageSnippet(message.text, query), query)}</div>
        ) : null}
        {attachments ? (
          <div className="faint row" style={{ fontSize: 12, gap: 4 }}>
            <Gi icon={Paperclip} size={11} />
            {attachments} {attachments === 1 ? "attachment" : "attachments"}
          </div>
        ) : null}
      </div>
    </div>
  );
}
