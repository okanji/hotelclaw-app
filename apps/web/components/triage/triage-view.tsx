"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Inbox, Plus } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty-state";
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
 * Triage — Linear's incoming-issue inbox. Left: the pending queue (live via
 * Realtime). Right: the selected task in the real task detail, with Accept /
 * Decline in its header. `1` accept · `2` decline · `j`/`k` move. After a
 * decision the next row is selected, so a queue can be worked top to bottom
 * from the keyboard. Selection + team filter ride in `?task=` / `?team=`
 * (replaceState — no navigation, the page is client-driven after load).
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
    if (selected) url.searchParams.set("task", selected.id);
    else url.searchParams.delete("task");
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
  const createButton = (
    <Button variant="ghost" size="sm" onClick={() => setCreateOpen(true)}>
      <Plus />
      Create triage issue
    </Button>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="Triage"
        icon={<Inbox />}
        meta={
          isPending ? null : (
            <span className="tabular-nums">
              {count === 1 ? "1 issue to triage" : `${count} issues to triage`}
            </span>
          )
        }
        actions={createButton}
      />

      <div className="flex min-h-0 flex-1">
        <aside
          className={cn(
            "flex min-h-0 w-full shrink-0 flex-col border-r border-border md:w-[340px]",
            mobileDetail && selected && "max-md:hidden",
          )}
        >
          {teamsInQueue.length > 0 ? (
            <div className="flex flex-wrap gap-1 pr-3 pl-(--page-gutter) pt-1 pb-1.5">
              <Chip size="sm" selected={!teamId} onClick={() => setTeamId(null)}>
                All
              </Chip>
              {teamsInQueue.map((s) => (
                <Chip
                  key={s.id}
                  size="sm"
                  selected={teamId === s.id}
                  onClick={() => setTeamId(teamId === s.id ? null : s.id)}
                >
                  {s.name}
                </Chip>
              ))}
            </div>
          ) : null}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {visible.length > 0 ? (
              <TriageList
                items={visible}
                selectedId={selected?.id ?? null}
                spaceNames={spaceNames}
                onSelect={select}
              />
            ) : isPending ? null : (
              <p className="pr-5 pl-(--page-gutter) py-6 text-sm text-muted-foreground">
                Nothing waiting{teamId ? " for this team" : ""}.
              </p>
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
            <div className="flex flex-1 items-center justify-center p-8">
              <EmptyState
                bare
                icon={Inbox}
                title="Triage is clear"
                action={createButton}
              >
                Guest chatbot tickets and anything submitted to triage wait
                here until a teammate accepts or declines them.
              </EmptyState>
            </div>
          )}
        </section>
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
