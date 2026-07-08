"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, BellRing, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  insightsAlertRulesQueryOptions,
  insightsFollowsQueryOptions,
  type InsightAlertRuleRow,
} from "@/lib/query/insights-queries";
import {
  projectsQueryOptions,
  spacesQueryOptions,
} from "@/lib/query/project-queries";
import { propertyMembersQueryOptions } from "@/lib/query/section-queries";
import { scopeKey, type InsightScope } from "@/lib/insights/scope";
import { NativeSelect } from "@/components/ui/native-select";

/**
 * Follow + alerts entry point in the Insights header. The popover sets the
 * email cadence for the lens currently being viewed; the dialog manages all
 * follows, threshold alert rules, and the global email switches. Delivery
 * itself renders the already-cached briefs — following costs nothing until
 * the morning cron.
 */

const METRIC_LABEL: Record<InsightAlertRuleRow["metric"], string> = {
  overdue_count: "Overdue tasks",
  blocked_count: "Blocked tasks",
  unassigned_urgent_count: "Unassigned urgent",
  project_at_risk: "Project at risk",
};

export function InsightsFollowButton({
  propertyId,
  scope,
}: {
  propertyId: string;
  scope: InsightScope;
}) {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const { data: follows = [] } = useQuery(
    insightsFollowsQueryOptions(propertyId),
  );
  const key = scopeKey(scope);
  const current = follows.find((f) => f.scope === key);

  const setCadence = useMutation({
    mutationFn: async (cadence: "daily" | "weekly" | "off") => {
      const res = await fetch(
        `/api/properties/${propertyId}/insights/follows`,
        {
          method: cadence === "off" ? "DELETE" : "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            cadence === "off" ? { scope: key } : { scope: key, cadence },
          ),
        },
      );
      if (!res.ok) throw new Error("Couldn't update the follow");
    },
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ["insights", propertyId, "follows"],
      }),
    onError: (e) => toast.error(e.message),
  });

  return (
    <>
      <Popover>
        <PopoverTrigger
          render={
            <Button type="button" size="sm" variant="ghost">
              {current ? (
                <BellRing className="size-4" />
              ) : (
                <Bell className="size-4" />
              )}
              Follow
            </Button>
          }
        />
        <PopoverContent align="end" sideOffset={6} className="w-64 p-3">
          <p className="mb-2 text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">
            Email this lens
          </p>
          <div className="flex flex-col gap-1">
            {(
              [
                ["daily", "Daily digest", "Every morning, if the numbers moved"],
                ["weekly", "Weekly digest", "Monday mornings"],
                ["off", "Off", "No emails for this lens"],
              ] as const
            ).map(([value, label, hint]) => {
              const active =
                value === "off" ? !current : current?.cadence === value;
              return (
                <button
                  key={value}
                  type="button"
                  disabled={setCadence.isPending}
                  onClick={() => setCadence.mutate(value)}
                  className={cn(
                    "flex flex-col items-start rounded-md px-2.5 py-1.5 text-left transition-colors hover:bg-muted",
                    active && "bg-muted",
                  )}
                >
                  <span className="text-sm font-medium text-foreground">
                    {label}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {hint}
                  </span>
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => setDialogOpen(true)}
            className="mt-2 w-full rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            Manage emails &amp; alerts…
          </button>
        </PopoverContent>
      </Popover>

      <InsightsSubscriptionsDialog
        propertyId={propertyId}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </>
  );
}

function InsightsSubscriptionsDialog({
  propertyId,
  open,
  onOpenChange,
}: {
  propertyId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { data: follows = [] } = useQuery({
    ...insightsFollowsQueryOptions(propertyId),
    enabled: open,
  });
  const { data: rules = [] } = useQuery({
    ...insightsAlertRulesQueryOptions(propertyId),
    enabled: open,
  });
  const { data: projects = [] } = useQuery({
    ...projectsQueryOptions(propertyId),
    enabled: open,
  });
  const { data: spaces = [] } = useQuery({
    ...spacesQueryOptions(propertyId),
    enabled: open,
  });
  const { data: members = [] } = useQuery({
    ...propertyMembersQueryOptions(propertyId),
    enabled: open,
  });
  const { data: prefs } = useQuery({
    queryKey: ["me", "email-prefs"] as const,
    enabled: open,
    queryFn: async () => {
      const res = await fetch("/api/me/email-prefs", { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to load email settings");
      const body = (await res.json()) as {
        prefs: {
          digestsEnabled: boolean;
          alertsEnabled: boolean;
          unsubscribedAt: string | null;
        };
      };
      return body.prefs;
    },
  });

  const lensLabel = useMemo(() => {
    const map = new Map<string, string>([["property", "Whole property"]]);
    for (const p of projects) map.set(`project:${p.id}`, p.name);
    for (const s of spaces) map.set(`space:${s.id}`, s.name);
    for (const m of members) map.set(`person:${m.id}`, m.name ?? "Member");
    return (scope: string) => map.get(scope) ?? scope;
  }, [projects, spaces, members]);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["insights", propertyId] });

  async function patchPrefs(body: Record<string, unknown>) {
    const res = await fetch("/api/me/email-prefs", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) toast.error("Couldn't update email settings");
    await queryClient.invalidateQueries({ queryKey: ["me", "email-prefs"] });
  }

  async function removeFollow(scope: string) {
    await fetch(`/api/properties/${propertyId}/insights/follows`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope }),
    });
    await invalidate();
  }

  async function removeRule(ruleId: string) {
    await fetch(
      `/api/properties/${propertyId}/insights/alert-rules/${ruleId}`,
      { method: "DELETE" },
    );
    await invalidate();
  }

  async function toggleRule(rule: InsightAlertRuleRow) {
    await fetch(
      `/api/properties/${propertyId}/insights/alert-rules/${rule.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !rule.enabled }),
      },
    );
    await invalidate();
  }

  // Add-rule form state.
  const [newScope, setNewScope] = useState("property");
  const [newMetric, setNewMetric] =
    useState<InsightAlertRuleRow["metric"]>("overdue_count");
  const [newThreshold, setNewThreshold] = useState(5);
  const [adding, setAdding] = useState(false);

  async function addRule() {
    setAdding(true);
    try {
      const res = await fetch(
        `/api/properties/${propertyId}/insights/alert-rules`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            scope: newScope,
            metric: newMetric,
            threshold: newMetric === "project_at_risk" ? null : newThreshold,
          }),
        },
      );
      if (!res.ok) throw new Error("Couldn't add the rule");
      await invalidate();
      toast.success("Alert rule added");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't add the rule");
    } finally {
      setAdding(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-base font-medium tracking-tight">
            Emails &amp; alerts
          </DialogTitle>
          <DialogDescription className="text-sm tracking-tight text-muted-foreground">
            Digests render the same brief you see on this page; alert rules
            check the same deterministic numbers, once a day, and fire when a
            threshold is newly crossed.
          </DialogDescription>
        </DialogHeader>

        {prefs?.unsubscribedAt ? (
          <div className="flex items-center justify-between rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2">
            <p className="text-sm text-foreground">
              You unsubscribed from all Hotelclaw emails.
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void patchPrefs({ resubscribe: true })}
            >
              Re-enable
            </Button>
          </div>
        ) : null}

        <div className="flex flex-col gap-5">
          <section className="flex flex-col gap-2">
            <h3 className="text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">
              Followed lenses
            </h3>
            {follows.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing followed yet — use the Follow button on any lens.
              </p>
            ) : (
              <ul className="flex flex-col divide-y divide-border/40">
                {follows.map((f) => (
                  <li key={f.id} className="flex items-center gap-3 py-1.5">
                    <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                      {lensLabel(f.scope)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {f.cadence}
                    </span>
                    <button
                      type="button"
                      aria-label="Unfollow"
                      onClick={() => void removeFollow(f.scope)}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">
              Alert rules
            </h3>
            {rules.length > 0 ? (
              <ul className="flex flex-col divide-y divide-border/40">
                {rules.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 py-1.5">
                    <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                      {METRIC_LABEL[r.metric]}
                      {r.threshold !== null ? ` > ${r.threshold}` : ""}
                      <span className="text-muted-foreground">
                        {" "}
                        · {lensLabel(r.scope)}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => void toggleRule(r)}
                      className={cn(
                        "rounded-full border px-2 py-0.5 text-xs font-medium",
                        r.enabled
                          ? "border-emerald-500/40 text-emerald-600"
                          : "border-border text-muted-foreground",
                      )}
                    >
                      {r.enabled ? "On" : "Off"}
                    </button>
                    <button
                      type="button"
                      aria-label="Delete rule"
                      onClick={() => void removeRule(r.id)}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <NativeSelect
                value={newScope}
                aria-label="Alert scope"
                onChange={(e) => setNewScope(e.target.value)}
              >
                <option value="property">Whole property</option>
                {spaces.map((s) => (
                  <option key={s.id} value={`space:${s.id}`}>
                    {s.name}
                  </option>
                ))}
                {projects.map((p) => (
                  <option key={p.id} value={`project:${p.id}`}>
                    {p.name}
                  </option>
                ))}
              </NativeSelect>
              <NativeSelect
                value={newMetric}
                aria-label="Alert metric"
                onChange={(e) =>
                  setNewMetric(e.target.value as InsightAlertRuleRow["metric"])
                }
              >
                {Object.entries(METRIC_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </NativeSelect>
              {newMetric !== "project_at_risk" ? (
                <label className="flex items-center gap-1 text-sm text-muted-foreground">
                  &gt;
                  <input
                    type="number"
                    min={0}
                    max={999}
                    value={newThreshold}
                    onChange={(e) => setNewThreshold(Number(e.target.value))}
                    className="h-8 w-16 rounded-md border border-input bg-transparent px-2 text-sm text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                </label>
              ) : null}
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={adding}
                onClick={() => void addRule()}
              >
                {adding ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Plus className="size-4" />
                )}
                Add rule
              </Button>
            </div>
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">
              Email switches
            </h3>
            <div className="flex flex-col gap-1.5">
              <label className="flex items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={prefs?.digestsEnabled ?? true}
                  onChange={(e) =>
                    void patchPrefs({ digestsEnabled: e.target.checked })
                  }
                  className="size-3.5 accent-foreground"
                />
                Digest emails
              </label>
              <label className="flex items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={prefs?.alertsEnabled ?? true}
                  onChange={(e) =>
                    void patchPrefs({ alertsEnabled: e.target.checked })
                  }
                  className="size-3.5 accent-foreground"
                />
                Alert emails
              </label>
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
