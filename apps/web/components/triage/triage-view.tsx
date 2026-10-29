"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Inbox, ListChecks, Plus } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/shell/page-header";
import { Gi } from "@/components/gr8r/icon";
import { spacesQueryOptions } from "@/lib/query/project-queries";
import {
  invalidateTriage,
  triageQueueQueryOptions,
  useTriageRealtime,
  type TriageQueueItem,
} from "@/lib/query/triage-queries";
import {
  nextTriageSelection,
  type TriageFieldValues,
} from "@/lib/tasks/triage-logic";
import { acceptTriageTask, declineTriageTask } from "./actions";
import { TriageList } from "./triage-list";
import { TriageTaskPane } from "./triage-task-pane";
import { TriageDecision } from "./triage-decision";
import { TriageCreateDialog } from "./triage-create-dialog";

/**
 * Triage — Linear's incoming-issue queue, part of Tasks (`/triage`; each
 * team's sidebar node links `/triage?team=<id>`). Left: the pending queue
 * (live via Realtime) with a team filter.
 * Right: the selected task in the real task detail, with Accept / Decline in
 * its header. `1` accept · `2` decline · `j`/`k` move. After a decision the
 * next row is selected, so a queue can be worked top to bottom from the
 * keyboard. Selection + team filter ride in `?issue=` / `?team=`
 * (replaceState — no navigation).
 */
export function TriageView({
  propertyId,
  initialTaskId,
  initialTeamId,
}: {
  propertyId: string;
  initialTaskId: string | null;
  initialTeamId: string | null;
}) {
  const qc = useQueryClient();
  useTriageRealtime(propertyId);

  const { data: queue = [], isPending } = useQuery(
    triageQueueQueryOptions(propertyId),
  );
  const { data: spaces = [] } = useQuery(spacesQueryOptions(propertyId));
  const spaceNames = useMemo(
    () => new Map(spaces.map((s) => [s.id, s.name] as const)),
    [spaces],
  );

  const [teamId, setTeamId] = useState<string | null>(initialTeamId);
  const [selectedId, setSelectedId] = useState<string | null>(initialTaskId);
  // Mobile: the list is the page until a row is opened.
  const [mobileDetail, setMobileDetail] = useState(Boolean(initialTaskId));
  const [acceptOpen, setAcceptOpen] = useState(false);
  const [declineOpen, setDeclineOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [busy, startTransition] = useTransition();

  const visible = useMemo(
    () => (teamId ? queue.filter((t) => t.space_id === teamId) : queue),
    [queue, teamId],
  );
  // Only teams that actually have something waiting get a filter chip.
  const teamsInQueue = useMemo(() => {
    const ids = new Set(queue.map((t) => t.space_id).filter(Boolean) as string[]);
    return spaces.filter((s) => ids.has(s.id));
  }, [queue, spaces]);

  const selected: TriageQueueItem | null =
    visible.find((t) => t.id === selectedId) ?? visible[0] ?? null;

  useEffect(() => {
    const url = new URL(window.location.href);
    if (selected) url.searchParams.set("issue", selected.id);
    else url.searchParams.delete("issue");
    if (teamId) url.searchParams.set("team", teamId);
    else url.searchParams.delete("team");
    if (url.href !== window.location.href) {
      window.history.replaceState(window.history.state, "", url);
    }
  }, [selected, teamId]);

  const select = useCallback((id: string) => {
    setSelectedId(id);
    setMobileDetail(true);
    setAcceptOpen(false);
    setDeclineOpen(false);
  }, []);

  const move = useCallback(
    (delta: 1 | -1) => {
      if (!selected) return;
      const i = visible.findIndex((t) => t.id === selected.id);
      const next = visible[i + delta];
      if (next) select(next.id);
    },
    [selected, visible, select],
  );

  /** Drop the row optimistically and advance; the server call settles it. */
  const decide = useCallback(
    (
      task: TriageQueueItem,
      run: () => Promise<{ ok: true } | { error: string }>,
      done: string,
      accepted: boolean,
    ) => {
      const next = nextTriageSelection(
        visible.map((t) => t.id),
        task.id,
      );
      setAcceptOpen(false);
      setDeclineOpen(false);
      qc.setQueryData<TriageQueueItem[]>(["triage", propertyId], (old) =>
        old?.filter((t) => t.id !== task.id),
      );
      setSelectedId(next);
      if (!next) setMobileDetail(false);
      startTransition(async () => {
        const result = await run();
        if ("error" in result) {
          toast.error(result.error);
        } else {
          toast.success(done);
        }
        invalidateTriage(qc, propertyId, { board: accepted && !("error" in result) });
      });
    },
    [qc, propertyId, visible],
  );

  const accept = useCallback(
    (values: TriageFieldValues) => {
      if (!selected) return;
      decide(
        selected,
        () =>
          acceptTriageTask({
            taskId: selected.id,
            spaceId: values.spaceId,
            assigneeId: values.assigneeId,
            priority: values.priority,
            projectId: values.projectId,
          }),
        "Accepted to the board",
        true,
      );
    },
    [selected, decide],
  );

  const decline = useCallback(
    (note: string) => {
      if (!selected) return;
      decide(
        selected,
        () => declineTriageTask({ taskId: selected.id, note: note || undefined }),
        "Declined",
        false,
      );
    },
    [selected, decide],
  );

  // Keyboard: never while typing (task title/description, comment composer,
  // the popover forms) and never with a modifier held.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      const el = e.target as HTMLElement | null;
      if (
        el &&
        (el.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))
      ) {
        return;
      }
      if (createOpen || acceptOpen || declineOpen || !selected || busy) return;
      if (e.key === "1") {
        e.preventDefault();
        setAcceptOpen(true);
      } else if (e.key === "2") {
        e.preventDefault();
        setDeclineOpen(true);
      } else if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        move(1);
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        move(-1);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [createOpen, acceptOpen, declineOpen, selected, busy, move]);

  const count = visible.length;
  const countFor = (spaceId: string | null) =>
    spaceId ? queue.filter((t) => t.space_id === spaceId).length : queue.length;

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
      <PageHeader
        breadcrumbs={[
          { label: "Tasks", href: `/p/${propertyId}/tasks`, icon: <ListChecks /> },
          ...(teamId && spaceNames.get(teamId)
            ? [{ label: spaceNames.get(teamId)!, href: `/p/${propertyId}/spaces/${teamId}` }]
            : []),
          { label: "Triage" },
        ]}
        meta={
          isPending ? null : (
            <span className="tabular-nums">
              {count === 1 ? "1 issue to triage" : `${count} issues to triage`}
            </span>
          )
        }
      />

      {/* gr8r's two-pane inbox (src/pages/inbox.js): the queue on the left as
          an `.inbox-list`, the selected issue's task detail on the right. */}
      <div className="page flush" style={{ flex: "1 1 0", minHeight: 0 }}>
        <div className="flex min-h-0 flex-1">
          <aside
            className={cn(
              "flex min-h-0 w-full shrink-0 flex-col md:w-[380px]",
              mobileDetail && selected && "max-md:hidden",
            )}
            style={{ borderRight: "1px solid var(--g8-border)" }}
          >
            <div className="row" style={{ padding: "18px var(--g8-gutter) 0" }}>
              <div className="col" style={{ minWidth: 0 }}>
                <h1
                  style={{
                    fontSize: "var(--g8-fs-xl)",
                    margin: 0,
                    fontWeight: 600,
                    letterSpacing: "-.015em",
                  }}
                >
                  Triage
                </h1>
                <span className="faint" style={{ fontSize: "var(--g8-fs-xs)", marginTop: 2 }}>
                  <span className="kbd">1</span> accept · <span className="kbd">2</span>{" "}
                  decline · <span className="kbd">j</span>/<span className="kbd">k</span> move
                </span>
              </div>
              <span className="sp" />
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setCreateOpen(true)}
                title="Create triage issue"
              >
                <Gi icon={Plus} size={13} />
                New issue
              </button>
            </div>
            {teamsInQueue.length > 0 ? (
              <div className="chipsbar" role="group" aria-label="Filter by team">
                <button
                  type="button"
                  aria-pressed={!teamId}
                  className={cn("pillbtn", !teamId ? "bordered" : "empty")}
                  onClick={() => setTeamId(null)}
                >
                  All teams
                  <span className="faint tabular-nums">{countFor(null)}</span>
                </button>
                {teamsInQueue.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    aria-pressed={teamId === s.id}
                    className={cn("pillbtn", teamId === s.id ? "bordered" : "empty")}
                    onClick={() => setTeamId(teamId === s.id ? null : s.id)}
                  >
                    {s.name}
                    <span className="faint tabular-nums">{countFor(s.id)}</span>
                  </button>
                ))}
              </div>
            ) : null}
            <div className="inbox-list">
              {visible.length > 0 ? (
                <TriageList
                  items={visible}
                  selectedId={selected?.id ?? null}
                  spaceNames={spaceNames}
                  onSelect={select}
                />
              ) : isPending ? null : (
                <div className="empty-state sm">
                  <div className="glyph">
                    <Gi icon={Inbox} size={20} />
                  </div>
                  <h2 className="es-h">Nothing waiting</h2>
                  <p>
                    {teamId
                      ? "Requests for this team land here first."
                      : "New requests land here before they reach a board."}
                  </p>
                </div>
              )}
            </div>
          </aside>

          <section
            className={cn(
              "flex min-h-0 min-w-0 flex-1",
              !(mobileDetail && selected) && "max-md:hidden",
            )}
          >
            {selected ? (
              <TriageTaskPane
                propertyId={propertyId}
                task={selected}
                onBack={() => setMobileDetail(false)}
                decision={
                  <TriageDecision
                    propertyId={propertyId}
                    task={selected}
                    busy={busy}
                    acceptOpen={acceptOpen}
                    onAcceptOpenChange={setAcceptOpen}
                    declineOpen={declineOpen}
                    onDeclineOpenChange={setDeclineOpen}
                    onAccept={accept}
                    onDecline={decline}
                  />
                }
              />
            ) : isPending ? null : (
              <div className="fullstate" style={{ flex: 1 }}>
                <div className="box">
                  <div className="empty-state" style={{ padding: 0 }}>
                    <div className="glyph">
                      <Gi icon={Inbox} size={22} />
                    </div>
                    <h2 className="es-h">Triage is clear</h2>
                    <p>
                      Guest chatbot tickets and anything submitted to triage
                      wait here until a teammate accepts or declines them.
                    </p>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => setCreateOpen(true)}
                    >
                      <Gi icon={Plus} size={13} />
                      Create triage issue
                    </button>
                  </div>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>

      <TriageCreateDialog
        propertyId={propertyId}
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(taskId) => {
          setTeamId(null);
          setSelectedId(taskId);
          invalidateTriage(qc, propertyId);
        }}
      />
    </div>
  );
}
