"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSuspenseQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowUp,
  Ban,
  CheckCircle2,
  Circle,
  CircleSlash,
  Clock,
  Loader2,
  MoreHorizontal,
  Search,
  Sparkles,
  Workflow,
  XCircle,
} from "lucide-react";
import { builderPrefillHref } from "@/lib/workflows/features";
import { canRunNow } from "@/lib/workflows/summary";
import { workflowsListQueryOptions } from "@/lib/query/workflow-queries";
import { useWorkflowsRealtime } from "@/lib/workflows/use-workflows-realtime";
import { PageHeader } from "@/components/shell/page-header";
import { PageShell } from "@/components/ui/page-shell";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import { Switch } from "@/components/ui/switch";
import { TabNav, TabNavItem } from "@/components/ui/tab-nav";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useViewerId } from "@/components/activity/activity-log";
import { WorkflowsTabs } from "./workflows-tabs";
import { FlowSummary } from "./flow-summary";
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

// Run-status palette mirrors workflow-runs.tsx so the list and the runs view
// read as one system. Each status maps to a leading glyph (left-edge scan) and
// a StatusBadge tone (right-edge label).
const RUN_STATUS: Record<
  string,
  {
    label: string;
    icon: typeof CheckCircle2;
    tone: string;
    badgeTone: React.ComponentProps<typeof StatusBadge>["tone"];
    spin?: boolean;
  }
> = {
  succeeded: {
    label: "Succeeded",
    icon: CheckCircle2,
    tone: "text-success",
    badgeTone: "success",
  },
  failed: {
    label: "Failed",
    icon: XCircle,
    tone: "text-destructive",
    badgeTone: "danger",
  },
  running: {
    label: "Running",
    icon: Loader2,
    tone: "text-info",
    badgeTone: "info",
    spin: true,
  },
  waiting: {
    label: "Waiting",
    icon: Clock,
    tone: "text-warning",
    badgeTone: "warning",
  },
  queued: {
    label: "Queued",
    icon: Circle,
    tone: "text-muted-foreground",
    badgeTone: "neutral",
  },
  filtered: {
    label: "Filtered",
    icon: CircleSlash,
    tone: "text-muted-foreground",
    badgeTone: "neutral",
  },
  cancelled: {
    label: "Cancelled",
    icon: Ban,
    tone: "text-muted-foreground",
    badgeTone: "neutral",
  },
};

function formatRelative(iso: string | null) {
  if (!iso) return null;
  const ms = Date.now() - Date.parse(iso);
  if (isNaN(ms)) return null;
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

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

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        breadcrumbs={[
          { label: "Workflows", icon: <Workflow />, href: `/p/${propertyId}/workflows` },
        ]}
        actions={
          <div className="flex items-center gap-1.5">
            <Link
              href={`/p/${propertyId}/workflows/new`}
              className="inline-flex h-7 items-center gap-1.5 rounded-md bg-primary px-2 text-sm font-medium text-primary-foreground hover:bg-primary/80"
            >
              <Sparkles className="size-3.5" />
              New workflow
            </Link>
          </div>
        }
      />
      <WorkflowsTabs propertyId={propertyId} />
      <div className="flex-1 overflow-y-auto">
        <PageShell width="full" className="pt-8 pb-12">
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
                <ul
                  role="list"
                  className="divide-y divide-border"
                >
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
        </PageShell>
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
    <div className="mb-3 flex items-center gap-2">
      <div className="relative flex-1">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Search workflows…"
          className="h-8 pl-8 text-sm"
          aria-label="Search workflows"
        />
      </div>
      <TabNav variant="pill" aria-label="Filter workflows">
        {filters.map((f) => (
          <TabNavItem
            key={f.key}
            active={filter === f.key}
            onClick={() => onFilter(f.key)}
          >
            {f.label}
          </TabNavItem>
        ))}
        <TabNavItem
          active={filter === "failing"}
          disabled={failingCount === 0}
          onClick={() => onFilter(filter === "failing" ? "all" : "failing")}
          className={cn(
            failingCount === 0 && "cursor-default opacity-40",
            filter === "failing"
              ? "bg-destructive/10! text-destructive!"
              : "hover:text-destructive!",
          )}
        >
          {failingCount > 0 ? `${failingCount} failing` : "Failing"}
        </TabNavItem>
      </TabNav>
      <span className="w-14 text-right text-xs tabular-nums text-muted-foreground">
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
  const status = w.last_run_status ? RUN_STATUS[w.last_run_status] : null;
  const StatusIcon = status?.icon ?? Circle;
  const relative = formatRelative(w.last_run_at);

  return (
    <li className="group relative flex items-center gap-3 pr-2 pl-3 hover:bg-accent">
      <Link
        href={`/p/${propertyId}/workflows/${w.id}`}
        title={w.description ?? undefined}
        className={cn(
          "flex min-w-0 flex-1 items-start gap-3 py-2.5",
          !w.enabled && "opacity-55",
        )}
      >
        <StatusIcon
          aria-hidden
          className={cn(
            "mt-0.5 size-4 shrink-0",
            w.enabled ? (status?.tone ?? "text-muted-foreground/40") : "text-muted-foreground/40",
            status?.spin && w.enabled && "animate-spin",
          )}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground">{w.name}</span>
          </div>
          <FlowSummary trigger={w.trigger_event_type} stepTypes={w.step_types} />
        </div>
      </Link>

      <div className="flex shrink-0 items-center gap-3">
        <div className="hidden items-center gap-2 sm:flex">
          {status ? (
            <StatusBadge tone={status.badgeTone} dot={false}>
              {status.label}
            </StatusBadge>
          ) : null}
          <span className="w-16 text-right text-xs tabular-nums text-muted-foreground">
            {relative ?? "Never run"}
          </span>
        </div>

        <Switch
          checked={w.enabled}
          disabled={busy}
          aria-label={`${w.enabled ? "Disable" : "Enable"} ${w.name}`}
          onCheckedChange={onToggle}
          onClick={(e) => e.stopPropagation()}
        />

        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={`Actions for ${w.name}`}
            className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-accent group-hover:opacity-100 data-[popup-open]:opacity-100"
          >
            <MoreHorizontal className="size-4" />
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
    <div className="rounded-lg bg-muted px-6 py-10 text-center">
      <p className="text-sm text-muted-foreground">No workflows match your filters.</p>
      <button
        type="button"
        onClick={onClear}
        className="mt-3 inline-flex h-7 items-center rounded-md bg-card px-2 text-sm font-medium text-foreground shadow-ring transition-colors hover:bg-accent"
      >
        Clear filters
      </button>
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
    <div className="mx-auto max-w-2xl pt-6">
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-foreground">Create a workflow</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Put busywork on autopilot — it runs on its own whenever its trigger happens.
          </p>
        </div>
        <Link
          href={`/p/${propertyId}/workflows/new`}
          className="inline-flex h-7 shrink-0 items-center rounded-md bg-card px-2 text-sm font-medium text-foreground shadow-ring transition-colors hover:bg-accent"
        >
          Start fresh
        </Link>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="rounded-lg bg-card p-3 shadow-ring focus-within:shadow-focus"
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
          rows={2}
          aria-label="Describe the workflow"
          placeholder="Describe it — e.g. “When a task labeled guest-complaint is created, notify the manager on duty”"
          className="w-full resize-none bg-transparent text-sm text-foreground outline-none placeholder:text-faint-foreground"
        />
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1 text-xs text-faint-foreground">
            <Sparkles className="size-3.5" aria-hidden />
            AI builds it — you review before it turns on
          </span>
          <button
            type="submit"
            disabled={!goal.trim()}
            aria-label="Build with AI"
            className="inline-flex size-7 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity hover:bg-primary/80 disabled:opacity-40"
          >
            <ArrowUp className="size-4" />
          </button>
        </div>
      </form>
      <div className="mt-4 text-center">
        <Link
          href={`/p/${propertyId}/workflows/templates`}
          className="text-xs font-medium text-primary-ink hover:underline"
        >
          Or start from a template →
        </Link>
      </div>
    </div>
  );
}
