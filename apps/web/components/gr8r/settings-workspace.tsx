"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, Crown, KeyRound, Plus, Trash2, UserPlus, Users } from "lucide-react";
import { Gi } from "@/components/gr8r/icon";
import { Av } from "@/components/gr8r/home-glyphs";
import { InviteDialog } from "@/components/shell/invite-dialog";
import { MembersDialog } from "@/components/shell/members-dialog";
import { InvitesDialog } from "@/components/shell/invites-dialog";
import { GuestAccessDialog } from "@/components/members/guest-access-dialog";
import { CycleSettingsForm } from "@/components/cycles/cycle-settings-form";
import { ActionsApiKeys } from "@/components/fleet/actions-api-dialog";
import { setChannelCreationPolicy } from "@/components/chat/actions";
import { updatePropertyDetails } from "@/app/p/[propertyId]/settings/actions";
import {
  propertyMembersQueryOptions,
  type PropertyMember,
} from "@/lib/query/section-queries";
import { spacesQueryOptions } from "@/lib/query/project-queries";
import type { CycleSettingsRow } from "@/lib/cycles/types";
import { Faint, SBlock, Sel, SetHead, Srow, Tog } from "./settings-ui";

export type SettingsProperty = {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  taskPrefix: string;
  channelCreation: "everyone" | "management";
  /** Pod (client) properties get the Actions API. */
  isPod: boolean;
};

/* ── Workspace details ───────────────────────────────────────────────── */

function timeZones(current: string): string[] {
  let zones: string[] = [];
  try {
    zones = Intl.supportedValuesOf("timeZone");
  } catch {
    zones = [];
  }
  return zones.includes(current) ? zones : [current, ...zones];
}

export function WorkspaceSection({ property }: { property: SettingsProperty }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [name, setName] = useState(property.name);
  const [timezone, setTimezone] = useState(property.timezone);
  const [prefix, setPrefix] = useState(property.taskPrefix);
  const [channelPolicy, setChannelPolicy] = useState(property.channelCreation);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const zones = useMemo(() => timeZones(property.timezone), [property.timezone]);

  const dirty =
    name.trim() !== property.name ||
    timezone !== property.timezone ||
    prefix.trim().toUpperCase() !== property.taskPrefix;

  function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res = await updatePropertyDetails({
        propertyId: property.id,
        name,
        timezone,
        taskPrefix: prefix,
      });
      if ("error" in res) {
        setError(res.error);
        return;
      }
      toast.success("Workspace updated");
      router.refresh();
    });
  }

  function changePolicy(next: "everyone" | "management") {
    const prev = channelPolicy;
    setChannelPolicy(next);
    start(async () => {
      const res = await setChannelCreationPolicy({ propertyId: property.id, policy: next });
      if ("error" in res) {
        setChannelPolicy(prev);
        toast.error(res.error);
        return;
      }
      void qc.invalidateQueries({ queryKey: ["channel-creation-policy", property.id] });
      toast.success("Channel creation updated");
    });
  }

  return (
    <>
      <SetHead title="Workspace" lead="Your property's name, clock and identity." />
      <form onSubmit={save} className="sblock" style={{ marginTop: 0 }}>
        <div className="col" style={{ gap: 14, maxWidth: 440 }}>
          <div className="field">
            <label className="label" htmlFor="ws-name">
              Property name
            </label>
            <input
              id="ws-name"
              className={`input${error ? " is-error" : ""}`}
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="field">
            <label className="label" htmlFor="ws-tz">
              Time zone
            </label>
            <select
              id="ws-tz"
              className="select"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
            >
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z.replace(/_/g, " ")}
                </option>
              ))}
            </select>
            <span className="hint">Cycles, due dates and reminders use this clock.</span>
          </div>
          <div className="field">
            <label className="label" htmlFor="ws-prefix">
              Task key prefix
            </label>
            <input
              id="ws-prefix"
              className="input mono"
              value={prefix}
              maxLength={5}
              style={{ width: 120, textTransform: "uppercase" }}
              onChange={(e) => setPrefix(e.target.value.replace(/[^a-zA-Z]/g, ""))}
            />
            <span className="hint">
              Tasks read {prefix.toUpperCase() || "HC"}-142. Changing it relabels every
              task key, so old links that quote a key stop matching.
            </span>
          </div>
          {error ? <span className="err">{error}</span> : null}
          <div>
            <button type="submit" className="btn btn-primary" disabled={pending || !dirty}>
              {pending ? "Saving…" : "Save changes"}
            </button>
          </div>
        </div>
      </form>
      <SBlock title="Chat">
        <Srow t="Who can create channels" d="Direct messages are always open to everyone.">
          <Sel
            label="Who can create channels"
            value={channelPolicy}
            options={[
              ["everyone", "Everyone"],
              ["management", "Owners and managers"],
            ]}
            onChange={changePolicy}
          />
        </Srow>
      </SBlock>
    </>
  );
}

/* ── Members ─────────────────────────────────────────────────────────── */

const ROLE_LABEL: Record<string, string> = {
  owner: "Owner",
  manager: "Manager",
  staff: "Staff",
  guest: "Guest",
};

const EMPTY_MEMBERS: PropertyMember[] = [];

export function MembersSection({
  propertyId,
  propertyName,
  isOwner,
  currentEmail,
}: {
  propertyId: string;
  propertyName: string;
  isOwner: boolean;
  currentEmail: string;
}) {
  const { data: members = EMPTY_MEMBERS, isPending } = useQuery(
    propertyMembersQueryOptions(propertyId),
  );
  const [inviteOpen, setInviteOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [invitesOpen, setInvitesOpen] = useState(false);
  const full = members.filter((m) => m.role !== "guest");

  return (
    <>
      <SetHead
        title="Members"
        lead={
          isPending
            ? "Loading…"
            : `${full.length} ${full.length === 1 ? "person has" : "people have"} access to ${propertyName}.`
        }
      />
      <div className="row" style={{ marginBottom: 12, gap: 8, flexWrap: "wrap" }}>
        <button type="button" className="btn btn-primary" onClick={() => setInviteOpen(true)}>
          <Gi icon={UserPlus} size={14} />
          Invite member
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => setMembersOpen(true)}>
          {isOwner ? "Manage roles" : "View members"}
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => setInvitesOpen(true)}>
          Pending invites
        </button>
        <Link className="btn btn-ghost" href={`/p/${propertyId}/members`}>
          <Gi icon={Users} size={14} />
          Member directory
        </Link>
      </div>
      <div className="panel" style={{ overflow: "hidden" }}>
        {full.map((m) => (
          <div key={m.id} className="mini" style={{ minHeight: 52, cursor: "default" }}>
            <Av member={m} size="md" />
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="trunc" style={{ fontWeight: 500 }}>
                {m.name ?? m.email ?? "Member"}
              </div>
              {m.email ? (
                <div className="faint trunc" style={{ fontSize: 12 }}>
                  {m.email}
                </div>
              ) : null}
            </div>
            {m.role === "owner" ? (
              <span className="pillbtn">
                <Gi icon={Crown} size={13} />
                Owner
              </span>
            ) : (
              <span className="badge">{ROLE_LABEL[m.role] ?? m.role}</span>
            )}
          </div>
        ))}
        {!isPending && full.length === 0 ? <Faint>No members.</Faint> : null}
      </div>
      <p className="faint" style={{ fontSize: 12, marginTop: 10 }}>
        Only owners change roles or remove people.
      </p>
      <InviteDialog propertyId={propertyId} open={inviteOpen} onOpenChange={setInviteOpen} />
      <MembersDialog
        propertyId={propertyId}
        open={membersOpen}
        onOpenChange={setMembersOpen}
        canManage={isOwner}
        currentEmail={currentEmail}
      />
      <InvitesDialog
        propertyId={propertyId}
        open={invitesOpen}
        onOpenChange={setInvitesOpen}
        onInviteNew={() => setInviteOpen(true)}
      />
    </>
  );
}

/* ── Guests ──────────────────────────────────────────────────────────── */

export function GuestsSection({ propertyId }: { propertyId: string }) {
  const { data: members = EMPTY_MEMBERS, isPending } = useQuery(
    propertyMembersQueryOptions(propertyId),
  );
  const guests = members.filter((m) => m.role === "guest");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [access, setAccess] = useState<PropertyMember | null>(null);

  return (
    <>
      <SetHead
        title="Guests"
        lead="Outside collaborators — contractors, agencies, event crews — who see only the teams, lists, tasks and documents shared with them."
      />
      <div className="row" style={{ marginBottom: 12 }}>
        <button type="button" className="btn btn-primary" onClick={() => setInviteOpen(true)}>
          <Gi icon={UserPlus} size={14} />
          Invite guest
        </button>
      </div>
      <div className="panel" style={{ overflow: "hidden" }}>
        {guests.map((g) => (
          <div key={g.id} className="mini" style={{ minHeight: 52, cursor: "default" }}>
            <Av member={g} size="md" />
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="trunc" style={{ fontWeight: 500 }}>
                {g.name ?? g.email ?? "Guest"}
              </div>
              {g.email ? (
                <div className="faint trunc" style={{ fontSize: 12 }}>
                  {g.email}
                </div>
              ) : null}
            </div>
            <span className="badge amber">Guest</span>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setAccess(g)}
            >
              Access
            </button>
          </div>
        ))}
        {isPending ? <Faint>Loading…</Faint> : null}
        {!isPending && guests.length === 0 ? (
          <div style={{ padding: "0 14px" }}>
            <Faint>No guests yet. Pick the Guest role when inviting someone.</Faint>
          </div>
        ) : null}
      </div>
      <InviteDialog propertyId={propertyId} open={inviteOpen} onOpenChange={setInviteOpen} />
      {access ? (
        <GuestAccessDialog
          propertyId={propertyId}
          guest={{ id: access.id, name: access.name }}
          open
          onOpenChange={(o) => {
            if (!o) setAccess(null);
          }}
        />
      ) : null}
    </>
  );
}

/* ── Cycles ──────────────────────────────────────────────────────────── */

const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function cadenceSummary(s: CycleSettingsRow) {
  return `${s.duration_weeks === 1 ? "Weekly" : `${s.duration_weeks}-week`} · starts ${WEEKDAY[s.start_weekday]}${s.auto_rollover ? " · open work rolls over" : ""}`;
}

export function CyclesSection({
  propertyId,
  cadences,
}: {
  propertyId: string;
  cadences: CycleSettingsRow[];
}) {
  const { data: spaces = [] } = useQuery(spacesQueryOptions(propertyId));
  const [editing, setEditing] = useState<string | null>(null);
  const [newScope, setNewScope] = useState<string>("");
  const spaceName = (id: string | null) =>
    id === null ? "Whole property" : (spaces.find((s) => s.id === id)?.name ?? "Team");
  const configured = new Set(cadences.map((c) => c.space_id ?? "property"));
  const addable = [
    ...(configured.has("property") ? [] : [["property", "Whole property"] as const]),
    ...spaces
      .filter((s) => !configured.has(s.id))
      .map((s) => [s.id, s.name] as const),
  ];
  const keyOf = (spaceId: string | null) => spaceId ?? "property";

  return (
    <>
      <SetHead
        title="Cycles"
        lead={
          <>
            Short, repeating planning windows — one cadence per team or for the
            whole property. Plan the work on{" "}
            <Link href={`/p/${propertyId}/cycles`}>Cycles</Link>.
          </>
        }
      />
      {cadences.length === 0 ? <Faint>No cadences yet.</Faint> : null}
      {cadences.map((c) => {
        const k = keyOf(c.space_id);
        return (
          <div key={c.id}>
            <Srow
              t={
                <span className="row" style={{ gap: 8 }}>
                  {spaceName(c.space_id)}
                  {c.enabled ? null : <span className="badge">Off</span>}
                </span>
              }
              d={c.enabled ? cadenceSummary(c) : "Cycles are turned off for this scope."}
            >
              <Link className="btn btn-ghost btn-sm" href={`/p/${propertyId}/cycles?space=${k}`}>
                Open
              </Link>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setEditing(editing === k ? null : k)}
              >
                {editing === k ? "Close" : "Edit"}
              </button>
            </Srow>
            {editing === k ? (
              <div className="panel" style={{ padding: 16, margin: "12px 0" }}>
                <CycleSettingsForm
                  propertyId={propertyId}
                  spaceId={c.space_id}
                  settings={c}
                  onSaved={() => setEditing(null)}
                />
              </div>
            ) : null}
          </div>
        );
      })}
      {addable.length > 0 ? (
        <SBlock title="Add a cadence">
          <Srow t="Scope" d="Pick a team (or the whole property) to run cycles for.">
            <select
              className="select"
              style={{ width: "auto", minWidth: 180 }}
              aria-label="Cycle scope"
              value={newScope}
              onChange={(e) => setNewScope(e.target.value)}
            >
              <option value="">Choose…</option>
              {addable.map(([id, n]) => (
                <option key={id} value={id}>
                  {n}
                </option>
              ))}
            </select>
          </Srow>
          {newScope ? (
            <div className="panel" style={{ padding: 16, margin: "12px 0" }}>
              <CycleSettingsForm
                key={newScope}
                propertyId={propertyId}
                spaceId={newScope === "property" ? null : newScope}
                settings={null}
                onSaved={() => setNewScope("")}
              />
            </div>
          ) : null}
        </SBlock>
      ) : null}
    </>
  );
}

/* ── AI triage ───────────────────────────────────────────────────────── */

type TriageField = "space" | "assignee" | "priority";
const TRIAGE_FIELDS: [TriageField, string][] = [
  ["space", "Team"],
  ["assignee", "Assignee"],
  ["priority", "Priority"],
];

type TriageSettings = {
  autoApply: Partial<Record<TriageField, boolean>>;
  stats: Record<string, { accepted: number; dismissed: number; autoApplied: number }>;
  canEdit: boolean;
};

/** Same key as the board toolbar's TriageDial, so both stay in step. */
function triageSettingsQueryOptions(propertyId: string) {
  return queryOptions({
    queryKey: ["triage-settings", propertyId] as const,
    staleTime: 60_000,
    queryFn: async (): Promise<TriageSettings> => {
      const res = await fetch(`/api/properties/${propertyId}/triage-settings`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error("Failed to load triage settings");
      return res.json();
    },
  });
}

export function TriageSection({ propertyId }: { propertyId: string }) {
  const qc = useQueryClient();
  const { data, isPending } = useQuery(triageSettingsQueryOptions(propertyId));
  const canEdit = data?.canEdit ?? false;

  async function toggle(field: TriageField, label: string, enabled: boolean) {
    const res = await fetch(`/api/properties/${propertyId}/triage-settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ field, enabled }),
    });
    if (!res.ok) {
      toast.error("Couldn't update — only owners can change autonomy");
      return;
    }
    await qc.invalidateQueries({ queryKey: ["triage-settings", propertyId] });
    toast.success(`${label} auto-apply ${enabled ? "on" : "off"}`);
  }

  return (
    <>
      <SetHead
        title="AI triage"
        lead="Bare new tasks get team, assignee and priority suggestions. Turn on auto-apply once a field has earned your trust — applied values stay badged on the task."
      />
      {isPending ? <Faint>Loading…</Faint> : null}
      {data
        ? TRIAGE_FIELDS.map(([field, label]) => {
            const s = data.stats[field];
            const reviewed = s ? s.accepted + s.dismissed : 0;
            const rate = reviewed > 0 ? Math.round((s!.accepted / reviewed) * 100) : null;
            const on = data.autoApply[field] === true;
            const ready = rate !== null && reviewed >= 5 && rate >= 80;
            const d = on
              ? `Auto-applying high-confidence calls${s?.autoApplied ? ` · ${s.autoApplied} applied` : ""}`
              : rate === null
                ? "Learning — no reviews yet"
                : `${rate}% accepted · ${reviewed} reviewed${ready ? " · safe to auto-apply" : ""}`;
            return (
              <Srow key={field} t={label} d={d}>
                {ready && !on ? <span className="badge green">Ready</span> : null}
                <Tog
                  label={`Auto-apply ${label}`}
                  checked={on}
                  disabled={!canEdit}
                  onChange={(v) => void toggle(field, label, v)}
                />
              </Srow>
            );
          })
        : null}
      {data && !canEdit ? (
        <p className="faint" style={{ fontSize: 12, marginTop: 10 }}>
          Only owners can change autonomy.
        </p>
      ) : null}
    </>
  );
}

/* ── API access ──────────────────────────────────────────────────────── */

type TokenRow = {
  id: string;
  name: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

function mcpTokensQueryOptions(propertyId: string) {
  return queryOptions({
    queryKey: ["api-tokens", propertyId] as const,
    queryFn: async (): Promise<TokenRow[]> => {
      const res = await fetch(`/api/properties/${propertyId}/api-tokens`, { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to load tokens");
      const body = (await res.json()) as { tokens: TokenRow[] };
      return body.tokens;
    },
  });
}

function copy(text: string, what: string) {
  void navigator.clipboard.writeText(text).then(
    () => toast.success(`${what} copied`),
    () => toast.error("Couldn't copy"),
  );
}

export function ApiAccessSection({
  propertyId,
  isOwner,
  isPod,
}: {
  propertyId: string;
  isOwner: boolean;
  isPod: boolean;
}) {
  const qc = useQueryClient();
  const { data: tokens = [], isPending } = useQuery({
    ...mcpTokensQueryOptions(propertyId),
    enabled: isOwner,
  });
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null);
  const mcpUrl =
    typeof window !== "undefined" ? `${window.location.origin}/api/mcp/mcp` : "/api/mcp/mcp";

  const invalidate = () => qc.invalidateQueries({ queryKey: ["api-tokens", propertyId] });

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    try {
      const res = await fetch(`/api/properties/${propertyId}/api-tokens`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (!res.ok) throw new Error("Couldn't create the token");
      const body = (await res.json()) as { token: string };
      setFresh(body.token);
      setName("");
      await invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't create the token");
    } finally {
      setCreating(false);
    }
  }

  async function revoke(id: string) {
    const res = await fetch(`/api/properties/${propertyId}/api-tokens/${id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Couldn't revoke");
      return;
    }
    await invalidate();
  }

  const active = tokens.filter((t) => !t.revoked_at);

  return (
    <>
      <SetHead
        title="API access"
        lead="Connect Claude, ChatGPT or scripts to this property's live numbers over MCP. Tokens are read-only and scoped to this property."
      />
      {!isOwner ? (
        <div className="alert" style={{ marginBottom: 14 }}>
          <Gi icon={KeyRound} size={15} />
          <span>Only the property owner can create or revoke API tokens.</span>
        </div>
      ) : (
        <>
          <SBlock title="Insights MCP endpoint" first>
            <Srow
              t={<span className="mono" style={{ fontSize: 12.5 }}>{mcpUrl}</span>}
              d={
                <>
                  Streamable HTTP. Send the token as{" "}
                  <span className="mono">Authorization: Bearer hc_…</span>
                </>
              }
            >
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => copy(mcpUrl, "Endpoint URL")}
              >
                <Gi icon={Copy} size={13} />
                Copy
              </button>
            </Srow>
          </SBlock>
          {fresh ? (
            <div className="alert ok" style={{ marginTop: 14 }}>
              <div className="grow" style={{ minWidth: 0 }}>
                <b>Token created — copy it now, it won&apos;t be shown again.</b>
                <div className="mono trunc" style={{ fontSize: 12, marginTop: 4 }}>
                  {fresh}
                </div>
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => copy(fresh, "Token")}
              >
                <Gi icon={Copy} size={13} />
                Copy
              </button>
            </div>
          ) : null}
          <SBlock title="Tokens">
            {isPending ? <Faint>Loading…</Faint> : null}
            {!isPending && active.length === 0 ? <Faint>No active tokens.</Faint> : null}
            {active.map((t) => (
              <Srow
                key={t.id}
                t={t.name}
                d={
                  t.last_used_at
                    ? `Last used ${new Date(t.last_used_at).toLocaleDateString()}`
                    : "Never used"
                }
              >
                <button
                  type="button"
                  className="btn btn-danger-ghost btn-sm"
                  onClick={() => void revoke(t.id)}
                >
                  <Gi icon={Trash2} size={13} />
                  Revoke
                </button>
              </Srow>
            ))}
            <form onSubmit={create} className="row" style={{ gap: 8, marginTop: 12 }}>
              <input
                className="input grow"
                aria-label="Token name"
                placeholder="Token name (e.g. Claude Desktop)"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <button
                type="submit"
                className="btn btn-secondary"
                disabled={creating || !name.trim()}
              >
                <Gi icon={Plus} size={14} />
                {creating ? "Creating…" : "Create"}
              </button>
            </form>
          </SBlock>
          {isPod ? (
            <SBlock title="Actions API">
              <p className="muted" style={{ fontSize: 13, margin: "8px 0 12px" }}>
                Write access for external automations, limited to the tools each key is granted.
              </p>
              <ActionsApiKeys propertyId={propertyId} />
            </SBlock>
          ) : null}
        </>
      )}
    </>
  );
}
