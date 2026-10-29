"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Gi } from "@/components/gr8r/icon";
import {
  getNotificationsEnabled,
  setNotificationsEnabled,
} from "@/components/chat/inbox/browser-notifications";
import {
  insightsAlertRulesQueryOptions,
  insightsFollowsQueryOptions,
  type InsightAlertRuleRow,
} from "@/lib/query/insights-queries";
import { projectsQueryOptions, spacesQueryOptions } from "@/lib/query/project-queries";
import { propertyMembersQueryOptions } from "@/lib/query/section-queries";
import { Faint, SBlock, Sel, SetHead, Srow, Tog } from "./settings-ui";

/* ── Desktop (browser) notifications ─────────────────────────────────── */

export function DesktopNotificationsSection({ propertyId }: { propertyId: string }) {
  const [enabled, setEnabled] = useState(false);
  const [pending, start] = useTransition();
  const [permission, setPermission] = useState<string | null>(null);

  useEffect(() => {
    // Browser-only state — read after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEnabled(getNotificationsEnabled());
    setPermission(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
  }, []);

  function toggle(next: boolean) {
    start(async () => {
      const ok = await setNotificationsEnabled(next);
      if (typeof Notification !== "undefined") setPermission(Notification.permission);
      if (next && !ok) {
        toast.error("Browser notifications were denied. Enable them in site settings to retry.");
        return;
      }
      setEnabled(ok);
      toast.success(ok ? "Notifications on" : "Notifications off");
    });
  }

  return (
    <>
      <SetHead
        title="Desktop"
        lead="Pop-up notifications from this browser while Hotelclaw is open."
      />
      <Srow
        t="Desktop notifications"
        d="Mentions, direct messages, assignments and approvals — the same events that land in your Inbox."
      >
        <Tog label="Desktop notifications" checked={enabled} disabled={pending} onChange={toggle} />
      </Srow>
      {permission === "denied" ? (
        <div className="alert warn" style={{ marginTop: 14 }}>
          <span>This browser blocks notifications for the site. Allow them in the address bar&apos;s site settings.</span>
        </div>
      ) : null}
      {permission === "unsupported" ? (
        <Faint>This browser doesn&apos;t support notifications.</Faint>
      ) : null}
      <Srow t="Inbox" d="Everything you're notified about is kept in your Inbox.">
        <Link className="btn btn-secondary btn-sm" href={`/p/${propertyId}/inbox`}>
          Open Inbox
        </Link>
      </Srow>
    </>
  );
}

/* ── Email ───────────────────────────────────────────────────────────── */

type EmailPrefs = {
  digestsEnabled: boolean;
  alertsEnabled: boolean;
  unsubscribedAt: string | null;
};

/** Same key the Insights follow dialog uses, so both stay in step. */
const emailPrefsQuery = {
  queryKey: ["me", "email-prefs"] as const,
  queryFn: async (): Promise<EmailPrefs> => {
    const res = await fetch("/api/me/email-prefs", { cache: "no-store" });
    if (!res.ok) throw new Error("Failed to load email settings");
    const body = (await res.json()) as { prefs: EmailPrefs };
    return body.prefs;
  },
};

export function EmailNotificationsSection() {
  const qc = useQueryClient();
  const { data: prefs, isPending } = useQuery(emailPrefsQuery);

  async function patch(body: Record<string, unknown>) {
    const res = await fetch("/api/me/email-prefs", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) toast.error("Couldn't update email settings");
    await qc.invalidateQueries({ queryKey: ["me", "email-prefs"] });
  }

  const off = !!prefs?.unsubscribedAt;
  return (
    <>
      <SetHead title="Email" lead="Choose which emails you receive." />
      {off ? (
        <div className="alert warn" style={{ marginBottom: 14 }}>
          <span className="grow">You unsubscribed from all Hotelclaw email.</span>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => void patch({ resubscribe: true })}
          >
            Resubscribe
          </button>
        </div>
      ) : null}
      <Srow
        t="Insight digests"
        d="Daily or weekly briefs for the Insights lenses you follow, at 07:30."
      >
        <Tog
          label="Insight digests"
          checked={prefs?.digestsEnabled ?? false}
          disabled={isPending || off}
          onChange={(v) => void patch({ digestsEnabled: v })}
        />
      </Srow>
      <Srow t="Alerts" d="When a threshold you set on Insights is crossed.">
        <Tog
          label="Alerts"
          checked={prefs?.alertsEnabled ?? false}
          disabled={isPending || off}
          onChange={(v) => void patch({ alertsEnabled: v })}
        />
      </Srow>
    </>
  );
}

/* ── Insight follows + alert rules (owner / manager) ─────────────────── */

const METRIC_LABEL: Record<InsightAlertRuleRow["metric"], string> = {
  overdue_count: "Overdue tasks",
  blocked_count: "Blocked tasks",
  unassigned_urgent_count: "Unassigned urgent",
  project_at_risk: "Project at risk",
};

export function InsightFollowsSection({ propertyId }: { propertyId: string }) {
  const qc = useQueryClient();
  const { data: follows = [], isPending } = useQuery(insightsFollowsQueryOptions(propertyId));
  const { data: rules = [] } = useQuery(insightsAlertRulesQueryOptions(propertyId));
  const { data: projects = [] } = useQuery(projectsQueryOptions(propertyId));
  const { data: spaces = [] } = useQuery(spacesQueryOptions(propertyId));
  const { data: members = [] } = useQuery(propertyMembersQueryOptions(propertyId));

  const lensLabel = useMemo(() => {
    const map = new Map<string, string>([["property", "Whole property"]]);
    for (const p of projects) map.set(`project:${p.id}`, `Project · ${p.name}`);
    for (const s of spaces) map.set(`space:${s.id}`, `Team · ${s.name}`);
    for (const m of members) map.set(`person:${m.id}`, `Person · ${m.name ?? "Member"}`);
    return (scope: string) => map.get(scope) ?? scope;
  }, [projects, spaces, members]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["insights", propertyId] });

  async function setCadence(scope: string, cadence: "daily" | "weekly" | "off") {
    const res = await fetch(`/api/properties/${propertyId}/insights/follows`, {
      method: cadence === "off" ? "DELETE" : "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cadence === "off" ? { scope } : { scope, cadence }),
    });
    if (!res.ok) toast.error("Couldn't update the follow");
    await invalidate();
  }

  async function toggleRule(rule: InsightAlertRuleRow) {
    const res = await fetch(`/api/properties/${propertyId}/insights/alert-rules/${rule.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !rule.enabled }),
    });
    if (!res.ok) toast.error("Couldn't update the alert");
    await invalidate();
  }

  async function removeRule(ruleId: string) {
    const res = await fetch(`/api/properties/${propertyId}/insights/alert-rules/${ruleId}`, {
      method: "DELETE",
    });
    if (!res.ok) toast.error("Couldn't remove the alert");
    await invalidate();
  }

  return (
    <>
      <SetHead
        title="Insights"
        lead={
          <>
            Lenses you follow by email and the thresholds that alert you. Add
            new ones from the bell on{" "}
            <Link href={`/p/${propertyId}/home/insights`}>Insights</Link>.
          </>
        }
      />
      <SBlock title="Followed lenses" first>
        {isPending ? <Faint>Loading…</Faint> : null}
        {!isPending && follows.length === 0 ? (
          <Faint>You don&apos;t follow any lens yet.</Faint>
        ) : null}
        {follows.map((f) => (
          <Srow key={f.id} t={lensLabel(f.scope)}>
            <Sel
              label={`Digest cadence for ${lensLabel(f.scope)}`}
              value={f.cadence as "daily" | "weekly" | "off"}
              options={[
                ["daily", "Daily"],
                ["weekly", "Weekly"],
                ["off", "Unfollow"],
              ]}
              onChange={(v) => void setCadence(f.scope, v)}
            />
          </Srow>
        ))}
      </SBlock>
      <SBlock title="Alert rules">
        {rules.length === 0 ? <Faint>No alert rules.</Faint> : null}
        {rules.map((r) => (
          <Srow
            key={r.id}
            t={`${METRIC_LABEL[r.metric]}${r.threshold != null ? ` ≥ ${r.threshold}` : ""}`}
            d={`${lensLabel(r.scope)}${r.last_triggered_at ? ` · last fired ${new Date(r.last_triggered_at).toLocaleDateString()}` : ""}`}
          >
            <Tog
              label={`Alert ${METRIC_LABEL[r.metric]} enabled`}
              checked={r.enabled}
              onChange={() => void toggleRule(r)}
            />
            <button
              type="button"
              className="ibtn ibtn-sm"
              aria-label="Remove alert"
              onClick={() => void removeRule(r.id)}
            >
              <Gi icon={Trash2} size={14} />
            </button>
          </Srow>
        ))}
      </SBlock>
    </>
  );
}
