"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSuspenseQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowUp,
  Ellipsis,
  LibraryBig,
  Search,
  Sparkles,
  Workflow,
} from "lucide-react";
import { builderPrefillHref } from "@/lib/workflows/features";
import { canRunNow } from "@/lib/workflows/summary";
import { workflowsListQueryOptions } from "@/lib/query/workflow-queries";
import { useWorkflowsRealtime } from "@/lib/workflows/use-workflows-realtime";
import { PageHeader } from "@/components/shell/page-header";
import { Gi } from "@/components/gr8r/icon";
import { Tog } from "@/components/gr8r/settings-ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useViewerId } from "@/components/activity/activity-log";
import { WorkflowsTabs } from "./workflows-tabs";
import { FlowSummary } from "./flow-summary";
import { RunBadge, RunGlyph, formatRelative, runStatusG8 } from "./g8-bits";
import {
  DeleteWorkflowDialog,
  duplicateWorkflowRequest,
  runWorkflowNowRequest,
} from "./workflow-actions";

type WorkflowRow = {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  mode: "instant" | "durable";
  /** Current version's trigger event type (e.g. "task.overdue"), or null for a
   *  workflow with no saved version yet. Drives the trigger badge. */
  trigger_event_type: string | null;
  step_types: string[];
  created_by: string | null;
  last_run_at: string | null;
  last_run_status: string | null;
  created_at: string;
  updated_at: string;
};

type Filter = "all" | "mine" | "active" | "disabled" | "failing";

export function WorkflowsList({ propertyId }: { propertyId: string }) {
  useWorkflowsRealtime(propertyId);
  const queryKey = workflowsListQueryOptions(propertyId).queryKey;
  const { data: workflows } = useSuspenseQuery(workflowsListQueryOptions(propertyId));
  const queryClient = useQueryClient();
  const router = useRouter();
  const viewerId = useViewerId();

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [pending, setPending] = useState<Set<string>>(new Set());

  const failingCount = useMemo(
    () => workflows.filter((w) => w.last_run_status === "failed").length,
    [workflows],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return workflows.filter((w) => {
      if (q && !`${w.name} ${w.description ?? ""}`.toLowerCase().includes(q)) return false;
      if (filter === "mine" && w.created_by !== viewerId) return false;
      if (filter === "active" && !w.enabled) return false;
      if (filter === "disabled" && w.enabled) return false;
      if (filter === "failing" && w.last_run_status !== "failed") return false;
      return true;
    });
  }, [workflows, query, filter, viewerId]);

  function setRows(updater: (rows: WorkflowRow[]) => WorkflowRow[]) {
    queryClient.setQueryData<WorkflowRow[]>(queryKey, (old) => (old ? updater(old) : old));
  }

  async function toggleEnabled(w: WorkflowRow) {
    if (pending.has(w.id)) return;
    setPending((p) => new Set(p).add(w.id));
    const next = !w.enabled;
    setRows((rows) => rows.map((r) => (r.id === w.id ? { ...r, enabled: next } : r)));
    try {
      const res = await fetch(`/api/properties/${propertyId}/workflows/${w.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      if (!res.ok) throw new Error(await res.text());
    } catch {
      setRows((rows) => rows.map((r) => (r.id === w.id ? { ...r, enabled: w.enabled } : r)));
      toast.error(`Couldn't ${next ? "enable" : "disable"} "${w.name}"`);
    } finally {
      setPending((p) => {
        const n = new Set(p);
        n.delete(w.id);
        return n;
      });
    }
  }

  async function deleteWorkflow(w: WorkflowRow): Promise<void> {
    const prev = workflows;
    setRows((rows) => rows.filter((r) => r.id !== w.id));
    try {
      const res = await fetch(`/api/properties/${propertyId}/workflows/${w.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success(`Deleted "${w.name}"`);
    } catch {
      setRows(() => prev);
      toast.error(`Couldn't delete "${w.name}"`);
    }
  }

  const has = workflows.length > 0;
  const onCount = workflows.filter((w) => w.enabled).length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        breadcrumbs={[
          { label: "Workflows", icon: <Workflow />, href: `/p/${propertyId}/workflows` },
        ]}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="page wide">
          <div className="ph">
            <div>
              <h1>Workflows</h1>
              <p>
                {has
                  ? `${workflows.length} ${workflows.length === 1 ? "workflow" : "workflows"} · ${onCount} on`
                  : "Put busywork on autopilot."}
              </p>
            </div>
            <div className="acts">
              <Link href={`/p/${propertyId}/workflows/templates`} className="btn btn-secondary">
                <Gi icon={LibraryBig} size={14} />
                Templates
              </Link>
              <Link href={`/p/${propertyId}/workflows/new`} className="btn btn-primary">
                <Gi icon={Sparkles} size={14} />
                New workflow
              </Link>
            </div>
          </div>
          <WorkflowsTabs propertyId={propertyId} />
          {has ? (
            <>
              <Toolbar
                query={query}
                onQuery={setQuery}
                filter={filter}
                onFilter={setFilter}
                failingCount={failingCount}
                total={workflows.length}
                shown={filtered.length}
              />
              {filtered.length > 0 ? (
                <ul role="list" className="panel" style={{ listStyle: "none", margin: 0, padding: 0 }}>
                  {filtered.map((w) => (
                    <Row
                      key={w.id}
                      w={w}
                      propertyId={propertyId}
                      busy={pending.has(w.id)}
                      onToggle={() => toggleEnabled(w)}
                      onViewRuns={() =>
                        router.push(`/p/${propertyId}/workflows/${w.id}/runs`)
                      }
                      onEdit={() => router.push(`/p/${propertyId}/workflows/${w.id}`)}
                      onRunNow={async () => {
                        const runId = await runWorkflowNowRequest(propertyId, w.id);
                        if (runId) router.push(`/p/${propertyId}/workflows/${w.id}/runs/${runId}`);
                      }}
                      onDuplicate={async () => {
                        const id = await duplicateWorkflowRequest(propertyId, w.id);
                        if (id) router.push(`/p/${propertyId}/workflows/${id}`);
                      }}
                      onDelete={() => deleteWorkflow(w)}
                    />
                  ))}
                </ul>
              ) : (
                <FilteredEmpty
                  onClear={() => {
                    setQuery("");
                    setFilter("all");
                  }}
                />
              )}
            </>
          ) : (
            <EmptyState propertyId={propertyId} />
          )}
        </div>
      </div>
    </div>
  );
}

function Toolbar({
  query,
  onQuery,
  filter,
  onFilter,
  failingCount,
  total,
  shown,
}: {
  query: string;
  onQuery: (v: string) => void;
  filter: Filter;
  onFilter: (f: Filter) => void;
  failingCount: number;
  total: number;
  shown: number;
}) {
  const filters: { key: Filter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "mine", label: "Mine" },
    { key: "active", label: "Active" },
    { key: "disabled", label: "Disabled" },
  ];
  return (
    <div className="row" style={{ marginBottom: 12, flexWrap: "wrap" }}>
      <div className="inwrap" style={{ flex: 1, minWidth: 200 }}>
        <Gi icon={Search} size={13} />
        <input
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Search workflows…"
          className="input search-sm"
          style={{ width: "100%" }}
          aria-label="Search workflows"
        />
      </div>
      <div className="seg" role="group" aria-label="Filter workflows">
        {filters.map((f) => (
          <button
            key={f.key}
            type="button"
            className={filter === f.key ? "on" : ""}
            aria-pressed={filter === f.key}
            onClick={() => onFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
        <button
          type="button"
          disabled={failingCount === 0}
          aria-pressed={filter === "failing"}
          className={filter === "failing" ? "on" : ""}
          style={
            failingCount === 0
              ? { opacity: 0.4, cursor: "default" }
              : filter === "failing"
                ? { color: "var(--g8-red)" }
                : undefined
          }
          onClick={() => onFilter(filter === "failing" ? "all" : "failing")}
        >
          {failingCount > 0 ? `${failingCount} failing` : "Failing"}
        </button>
      </div>
      <span className="faint num" style={{ fontSize: 12, minWidth: 40, textAlign: "right" }}>
        {shown === total ? `${total}` : `${shown}/${total}`}
      </span>
    </div>
  );
}

function Row({
  w,
  propertyId,
  busy,
  onToggle,
  onViewRuns,
  onEdit,
  onRunNow,
  onDuplicate,
  onDelete,
}: {
  w: WorkflowRow;
  propertyId: string;
  busy: boolean;
  onToggle: () => void;
  onViewRuns: () => void;
  onEdit: () => void;
  onRunNow: () => void;
  onDuplicate: () => void;
  onDelete: () => Promise<void>;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const status = runStatusG8(w.last_run_status);
  const relative = formatRelative(w.last_run_at);

  return (
    <li className="nrow" style={{ alignItems: "center", cursor: "default" }}>
      <Link
        href={`/p/${propertyId}/workflows/${w.id}`}
        title={w.description ?? undefined}
        className="row grow"
        style={{ alignItems: "flex-start", gap: 12, opacity: w.enabled ? 1 : 0.55 }}
      >
        <span style={{ marginTop: 1 }}>
          <RunGlyph status={w.last_run_status} muted={!w.enabled} />
        </span>
        <span className="col grow" style={{ gap: 3 }}>
          <span className="trunc" style={{ fontWeight: 500 }}>
            {w.name}
          </span>
          <FlowSummary trigger={w.trigger_event_type} stepTypes={w.step_types} />
        </span>
      </Link>

      <div className="row" style={{ gap: 12, flexShrink: 0 }}>
        <div className="row hidden sm:flex" style={{ gap: 8 }}>
          {status && w.last_run_status ? <RunBadge status={w.last_run_status} /> : null}
          <span className="faint num" style={{ fontSize: 12, width: 64, textAlign: "right" }}>
            {relative ?? "Never run"}
          </span>
        </div>

        <Tog
          label={`${w.enabled ? "Disable" : "Enable"} ${w.name}`}
          checked={w.enabled}
          disabled={busy}
          onChange={() => onToggle()}
        />

        <DropdownMenu>
          <DropdownMenuTrigger aria-label={`Actions for ${w.name}`} className="ibtn ibtn-sm">
            <Gi icon={Ellipsis} size={15} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-40">
            {canRunNow(w.trigger_event_type) ? (
              <DropdownMenuItem
                disabled={!w.enabled}
                onClick={onRunNow}
                title={w.enabled ? undefined : "Turn it on to run it"}
              >
                Run now
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem onClick={onToggle}>
              {w.enabled ? "Turn off" : "Turn on"}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onViewRuns}>View runs</DropdownMenuItem>
            <DropdownMenuItem onClick={onEdit}>Edit workflow</DropdownMenuItem>
            <DropdownMenuItem onClick={onDuplicate}>Duplicate</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => setConfirmDelete(true)}>
              Delete…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <DeleteWorkflowDialog
        name={w.name}
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        onConfirm={onDelete}
      />
    </li>
  );
}

function FilteredEmpty({ onClear }: { onClear: () => void }) {
  return (
    <div className="panel">
      <div className="empty-state sm">
        <div className="glyph">
          <Gi icon={Search} />
        </div>
        <p>No workflows match your filters.</p>
        <button type="button" onClick={onClear} className="btn btn-secondary btn-sm">
          Clear filters
        </button>
      </div>
    </div>
  );
}

// Linear's Loops page opens on "Create a new loop": a prompt box first, start
// fresh second, templates third. The prompt hands off to the builder's copilot
// via ?prefill= (the same door the ⚡ Automations suggestions use), so the AI
// conversation — clarifying questions included — happens in one place.
function EmptyState({ propertyId }: { propertyId: string }) {
  const router = useRouter();
  const [goal, setGoal] = useState("");
  const submit = () => {
    const g = goal.trim();
    if (g) router.push(builderPrefillHref(propertyId, g));
  };
  return (
    <div style={{ maxWidth: 640, margin: "8px auto 0" }}>
      <section className="panel">
        <div className="panel-h">
          <h2>Create a workflow</h2>
          <div className="acts">
            <Link href={`/p/${propertyId}/workflows/new`} className="btn btn-secondary btn-sm">
              Start fresh
            </Link>
          </div>
        </div>
        <div className="panel-b">
          <p className="muted" style={{ margin: "0 0 10px", fontSize: 13 }}>
            Put busywork on autopilot — it runs on its own whenever its trigger happens.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <textarea
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
              rows={3}
              aria-label="Describe the workflow"
              placeholder="Describe it — e.g. “When a task labeled guest-complaint is created, notify the manager on duty”"
              className="textarea"
              style={{ width: "100%", resize: "none" }}
            />
            <div className="row" style={{ marginTop: 8 }}>
              <span className="row faint" style={{ gap: 5, fontSize: 12 }}>
                <Gi icon={Sparkles} size={13} />
                AI builds it — you review before it turns on
              </span>
              <span className="sp" />
              <button
                type="submit"
                disabled={!goal.trim()}
                className="btn btn-primary btn-sm"
              >
                <Gi icon={ArrowUp} size={14} />
                Build with AI
              </button>
            </div>
          </form>
        </div>
      </section>
      <div style={{ marginTop: 14, textAlign: "center" }}>
        <Link
          href={`/p/${propertyId}/workflows/templates`}
          className="link"
          style={{ fontSize: 12 }}
        >
          Or start from a template →
        </Link>
      </div>
    </div>
  );
}
