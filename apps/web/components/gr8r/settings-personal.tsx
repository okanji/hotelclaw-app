"use client";

import { useRef, useState, useSyncExternalStore, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowDown,
  ArrowUp,
  Check,
  CircleAlert,
  CircleCheck,
  Monitor,
  Moon,
  Pin,
  PinOff,
  RefreshCw,
  Sun,
  Trash2,
  Upload,
} from "lucide-react";
import { Gi } from "@/components/gr8r/icon";
import { Av } from "@/components/gr8r/home-glyphs";
import { DeleteAccountDialog } from "@/components/shell/delete-account-dialog";
import { DEFAULT_PINS, NAV_APPS, NAV_APP_BY_ID } from "@/components/shell/nav-apps";
import { useNavPrefs, type NavSectionId } from "@/components/shell/use-nav-prefs";
import { updateAvatar, updateProfile } from "@/lib/auth/profile-actions";
import { createClient } from "@/lib/supabase/client";
import { useTimeFormat } from "@/lib/preferences/time-format-context";
import { calendarSourcesQueryOptions } from "@/lib/calendar/query-options";
import type { ConnectionRow } from "@/lib/calendar/types";
import { ACCENTS, useAppearancePrefs, type Accent } from "./appearance-prefs";
import { Faint, SBlock, Sel, Seg, SetHead, Srow } from "./settings-ui";

const noop = () => () => {};
/** next-themes only knows the theme after hydration. */
function useMounted() {
  return useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/* ── Appearance ──────────────────────────────────────────────────────── */

const THEMES = [
  ["light", "Light", Sun],
  ["dark", "Dark", Moon],
  ["system", "System", Monitor],
] as const;

export function AppearanceSection() {
  const mounted = useMounted();
  const { theme, setTheme } = useTheme();
  const current = mounted ? (theme ?? "system") : null;
  const { prefs, set } = useAppearancePrefs();

  return (
    <>
      <SetHead title="Appearance" lead="Customize how Hotelclaw looks on this device." />
      <SBlock title="Theme" first>
        <div className="themecards" style={{ marginTop: 12 }} role="radiogroup" aria-label="Theme">
          {THEMES.map(([k, n, Icon]) => {
            const on = current === k;
            return (
              <button
                key={k}
                type="button"
                className={`tcard${on ? " on" : ""}`}
                role="radio"
                aria-checked={on}
                onClick={() => setTheme(k)}
              >
                {/* gr8r paints mini light/dark mockups with literal colours;
                    the token set is per-mode, so a glyph stands in. */}
                <div
                  className="tprev"
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr",
                    placeItems: "center",
                    background: "var(--g8-sunken)",
                    color: "var(--g8-text-3)",
                  }}
                >
                  <Gi icon={Icon} size={26} />
                </div>
                <span className="row" style={{ fontWeight: 500, fontSize: 13, gap: 6 }}>
                  <Gi icon={Icon} size={14} />
                  {n}
                  {on ? (
                    <>
                      <span className="sp" />
                      <span style={{ color: "var(--g8-accent)" }}>
                        <Gi icon={CircleCheck} size={15} />
                      </span>
                    </>
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>
      </SBlock>
      <SBlock title="Accent color">
        <Srow t="Accent" d="Used for primary buttons, focus rings, and selection.">
          <div className="swatches" role="radiogroup" aria-label="Accent color">
            {ACCENTS.map((k: Accent) => {
              const on = prefs.accent === k;
              return (
                // Each swatch is its own `.g8` island carrying `data-accent`,
                // so it paints that accent's real token (light or dark) —
                // no literal colours.
                <button
                  key={k}
                  type="button"
                  className={`g8 sw${on ? " on" : ""}`}
                  data-accent={k === "indigo" ? undefined : k}
                  style={{ "--g8-c": "var(--g8-accent)" } as React.CSSProperties}
                  role="radio"
                  aria-checked={on}
                  aria-label={cap(k)}
                  title={cap(k)}
                  onClick={() => set("accent", k)}
                >
                  {on ? <Gi icon={Check} size={13} /> : null}
                </button>
              );
            })}
          </div>
        </Srow>
      </SBlock>
      <SBlock title="Density">
        <Srow t="Sidebar density" d="Compact fits more rows on screen.">
          <Seg
            label="Sidebar density"
            value={prefs.side}
            options={[
              ["comfortable", "Comfortable"],
              ["compact", "Compact"],
            ]}
            onChange={(v) => set("side", v)}
          />
        </Srow>
        <Srow t="Task display" d="Row height in lists and card padding on boards.">
          <Seg
            label="Task display"
            value={prefs.density}
            options={[
              ["comfortable", "Comfortable"],
              ["compact", "Compact"],
            ]}
            onChange={(v) => set("density", v)}
          />
        </Srow>
        <Srow t="Motion" d="Reduce animations for drawers, modals, and transitions.">
          <Sel
            label="Motion"
            value={prefs.motion}
            options={[
              ["system", "Follow system"],
              ["reduce", "Reduce motion"],
            ]}
            onChange={(v) => set("motion", v)}
          />
        </Srow>
      </SBlock>
    </>
  );
}

/* ── Date & time ─────────────────────────────────────────────────────── */

export function DateTimeSection({
  timezone,
  canManage,
  onGoWorkspace,
}: {
  timezone: string;
  canManage: boolean;
  onGoWorkspace: () => void;
}) {
  const { format, setFormat } = useTimeFormat();
  const preview = new Date(2026, 9, 1, 14, 30).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    hour12: format === "12h",
  });
  return (
    <>
      <SetHead title="Date & time" lead="How times appear across the workspace." />
      <Srow
        t="Time format"
        d={
          <>
            Preview: <b>{preview}</b>. Saved to your profile, so it follows you
            to every device.
          </>
        }
      >
        <Sel
          label="Time format"
          value={format}
          options={[
            ["12h", "12-hour (2:30 PM)"],
            ["24h", "24-hour (14:30)"],
          ]}
          onChange={(v) => void setFormat(v)}
        />
      </Srow>
      <Srow
        t="Property time zone"
        d="Cycles, due dates and reminders run on the property's clock."
      >
        <span className="muted">{timezone}</span>
        {canManage ? (
          <button type="button" className="btn btn-secondary btn-sm" onClick={onGoWorkspace}>
            Change
          </button>
        ) : null}
      </Srow>
    </>
  );
}

/* ── Profile ─────────────────────────────────────────────────────────── */

const AVATARS_BUCKET = "avatars";
const MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export function ProfileSection({
  user,
}: {
  user: { id: string; email: string; name: string | null; avatarUrl: string | null };
}) {
  const router = useRouter();
  const [fullName, setFullName] = useState(user.name ?? "");
  const [avatarUrl, setAvatarUrl] = useState(user.avatarUrl);
  const [busy, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!fullName.trim()) {
      setError("Enter your name");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await updateProfile({ fullName });
      if ("error" in result) {
        setError(result.error);
        return;
      }
      toast.success("Profile updated");
      router.refresh();
    });
  }

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!ALLOWED_TYPES.has(file.type)) {
      toast.error("Use a PNG, JPEG, WebP, or GIF image");
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error("Image must be 2 MB or smaller");
      return;
    }
    setUploading(true);
    try {
      const supabase = createClient();
      const ext = file.name.split(".").pop()?.toLowerCase() || "png";
      const path = `${user.id}/${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from(AVATARS_BUCKET)
        .upload(path, file, { contentType: file.type, cacheControl: "3600", upsert: false });
      if (uploadError) throw uploadError;
      const { data } = supabase.storage.from(AVATARS_BUCKET).getPublicUrl(path);
      const result = await updateAvatar(data.publicUrl);
      if ("error" in result) {
        await supabase.storage.from(AVATARS_BUCKET).remove([path]);
        throw new Error(result.error);
      }
      setAvatarUrl(data.publicUrl);
      toast.success("Avatar updated");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  function onRemoveAvatar() {
    if (!avatarUrl) return;
    setUploading(true);
    startTransition(async () => {
      const result = await updateAvatar(null);
      setUploading(false);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setAvatarUrl(null);
      toast.success("Avatar removed");
      router.refresh();
    });
  }

  return (
    <>
      <SetHead
        title="Profile"
        lead="How teammates see you in chat, mentions, and the members list."
      />
      <form onSubmit={onSubmit} className="col" style={{ gap: 16, maxWidth: 440 }}>
        <div className="row" style={{ gap: 14 }}>
          <Av member={{ id: user.id, name: fullName || user.email, avatarUrl }} size="lg" />
          <div>
            <div className="row" style={{ gap: 6 }}>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => fileRef.current?.click()}
                disabled={uploading || busy}
              >
                <Gi icon={Upload} size={13} />
                {uploading ? "Uploading…" : "Upload photo"}
              </button>
              {avatarUrl ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={onRemoveAvatar}
                  disabled={uploading || busy}
                >
                  Remove
                </button>
              ) : null}
            </div>
            <span className="hint">PNG, JPEG, WebP, or GIF. Max 2 MB.</span>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            hidden
            onChange={onPickFile}
          />
        </div>
        <div className="field">
          <label className="label" htmlFor="pf-name">
            Full name
          </label>
          <input
            id="pf-name"
            className={`input${error ? " is-error" : ""}`}
            value={fullName}
            maxLength={120}
            autoComplete="name"
            onChange={(e) => setFullName(e.target.value)}
            disabled={busy}
          />
          {error ? (
            <span className="err">
              <Gi icon={CircleAlert} size={12} />
              {error}
            </span>
          ) : null}
        </div>
        <div className="field">
          <label className="label" htmlFor="pf-email">
            Email
          </label>
          <input id="pf-email" className="input" value={user.email} disabled />
          <span className="hint">Your sign-in email can&apos;t be changed here.</span>
        </div>
        <div>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={busy || uploading || fullName.trim() === (user.name ?? "")}
          >
            {busy ? "Saving…" : "Save profile"}
          </button>
        </div>
      </form>
      <SBlock title="Danger zone" danger>
        <Srow
          t="Delete account"
          d="Properties you solely own are archived and you leave every other property. This cannot be undone."
        >
          <button
            type="button"
            className="btn btn-danger-ghost"
            style={{ border: "1px solid color-mix(in srgb, var(--g8-red) 35%, transparent)" }}
            onClick={() => setDeleteOpen(true)}
          >
            Delete account
          </button>
        </Srow>
      </SBlock>
      <DeleteAccountDialog email={user.email} open={deleteOpen} onOpenChange={setDeleteOpen} />
    </>
  );
}

/* ── Sidebar ─────────────────────────────────────────────────────────── */

const SECTION_ROWS: [NavSectionId, string, string][] = [
  ["favorites", "Favorites", "Starred tasks and pinned documents."],
  ["teams", "Teams", "Your teams with their views and lists."],
  ["projects", "Projects", "All projects, then each project."],
];

export function SidebarSection() {
  const prefs = useNavPrefs(DEFAULT_PINS);
  const mounted = useMounted();
  const unpinned = NAV_APPS.filter((a) => !prefs.pins.includes(a.id));

  return (
    <>
      <SetHead
        title="Sidebar"
        lead="Choose what the sidebar shows on this device. The same controls live under More → Customize sidebar."
      />
      <SBlock title="Groups" first>
        {SECTION_ROWS.map(([id, n, d]) => (
          <Srow key={id} t={n} d={d}>
            <input
              type="checkbox"
              className="toggle"
              aria-label={`Show ${n}`}
              checked={mounted ? !prefs.hidden.includes(id) : true}
              onChange={() => prefs.toggleSection(id)}
            />
          </Srow>
        ))}
      </SBlock>
      <SBlock title="Pinned apps">
        {prefs.pins.map((id, i) => {
          const app = NAV_APP_BY_ID.get(id);
          if (!app) return null;
          const Icon = app.icon;
          return (
            <Srow
              key={id}
              t={
                <span className="row" style={{ gap: 8 }}>
                  <Icon className="i" />
                  {app.label}
                </span>
              }
              d={app.hint}
            >
              <button
                type="button"
                className="ibtn ibtn-sm"
                aria-label={`Move ${app.label} up`}
                disabled={i === 0}
                onClick={() => prefs.movePin(id, -1)}
              >
                <Gi icon={ArrowUp} size={14} />
              </button>
              <button
                type="button"
                className="ibtn ibtn-sm"
                aria-label={`Move ${app.label} down`}
                disabled={i === prefs.pins.length - 1}
                onClick={() => prefs.movePin(id, 1)}
              >
                <Gi icon={ArrowDown} size={14} />
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => prefs.togglePin(id)}
              >
                <Gi icon={PinOff} size={13} />
                Unpin
              </button>
            </Srow>
          );
        })}
        {prefs.pins.length === 0 ? <Faint>No pinned apps — everything lives under More.</Faint> : null}
      </SBlock>
      {unpinned.length > 0 ? (
        <SBlock title="In More">
          {unpinned.map((app) => {
            const Icon = app.icon;
            return (
              <Srow
                key={app.id}
                t={
                  <span className="row" style={{ gap: 8 }}>
                    <Icon className="i" />
                    {app.label}
                  </span>
                }
                d={app.hint}
              >
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => prefs.togglePin(app.id)}
                >
                  <Gi icon={Pin} size={13} />
                  Pin
                </button>
              </Srow>
            );
          })}
        </SBlock>
      ) : null}
      {mounted && prefs.customized ? (
        <div style={{ marginTop: 16 }}>
          <button type="button" className="btn btn-ghost" onClick={prefs.reset}>
            Reset sidebar to default
          </button>
        </div>
      ) : null}
    </>
  );
}

/* ── Calendar accounts ───────────────────────────────────────────────── */

const PROVIDER_LABEL = { google: "Google Calendar", microsoft: "Outlook Calendar" } as const;

export function CalendarsSection({ propertyId }: { propertyId: string }) {
  const qc = useQueryClient();
  const { data, isPending } = useQuery(calendarSourcesQueryOptions());
  const [connecting, setConnecting] = useState<"google" | "microsoft" | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const connections = data?.connections ?? [];
  const has = (p: "google" | "microsoft") => connections.some((c) => c.provider === p);

  function connect(provider: "google" | "microsoft") {
    setConnecting(provider);
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `/api/calendar/${provider}/connect?next=${next}`;
  }

  async function refreshAll() {
    setRefreshing(true);
    const results = await Promise.allSettled(
      connections.map((c) =>
        fetch(`/api/calendar/${c.provider}/sync?connectionId=${c.id}`, { method: "POST" }),
      ),
    );
    setRefreshing(false);
    const failures = results.filter(
      (r) => r.status === "rejected" || (r.status === "fulfilled" && !r.value.ok),
    ).length;
    if (failures > 0) toast.error(`${failures} sync(s) failed`);
    else toast.success("Calendars refreshed");
    void qc.invalidateQueries({ queryKey: ["calendar-events", propertyId] });
    void qc.invalidateQueries({ queryKey: ["calendar-sources"] });
  }

  async function disconnect(c: ConnectionRow) {
    if (!confirm(`Disconnect ${c.account_email}? Events from this account will be removed.`)) return;
    const res = await fetch(`/api/me/calendar/connections/${c.id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Failed to disconnect");
      return;
    }
    toast.success("Disconnected");
    void qc.invalidateQueries({ queryKey: ["calendar-sources"] });
    void qc.invalidateQueries({ queryKey: ["calendar-events", propertyId] });
  }

  return (
    <>
      <SetHead
        title="Calendar accounts"
        lead={
          <>
            External calendars shown on your{" "}
            <Link href={`/p/${propertyId}/calendar`}>Planner</Link>. Which calendars
            show is chosen from the Planner&apos;s Calendars menu.
          </>
        }
      />
      {isPending ? <Faint>Loading…</Faint> : null}
      {connections.map((c) => (
        <Srow
          key={c.id}
          t={
            <span className="row" style={{ gap: 8 }}>
              <span style={{ color: c.last_sync_error ? "var(--g8-amber)" : "var(--g8-green)" }}>
                <Gi icon={c.last_sync_error ? CircleAlert : CircleCheck} size={15} />
              </span>
              {c.account_email}
            </span>
          }
          d={c.last_sync_error ? `${PROVIDER_LABEL[c.provider]} · last sync failed` : PROVIDER_LABEL[c.provider]}
        >
          <button
            type="button"
            className="btn btn-danger-ghost btn-sm"
            onClick={() => void disconnect(c)}
          >
            <Gi icon={Trash2} size={13} />
            Disconnect
          </button>
        </Srow>
      ))}
      {!isPending && connections.length === 0 ? (
        <Faint>No calendar accounts connected.</Faint>
      ) : null}
      <div className="row" style={{ marginTop: 16, gap: 8, flexWrap: "wrap" }}>
        {!has("google") ? (
          <button
            type="button"
            className="btn btn-secondary"
            disabled={connecting !== null}
            onClick={() => connect("google")}
          >
            {connecting === "google" ? "Redirecting…" : "Connect Google Calendar"}
          </button>
        ) : null}
        {!has("microsoft") ? (
          <button
            type="button"
            className="btn btn-secondary"
            disabled={connecting !== null}
            onClick={() => connect("microsoft")}
          >
            {connecting === "microsoft" ? "Redirecting…" : "Connect Outlook Calendar"}
          </button>
        ) : null}
        {connections.length > 0 ? (
          <button
            type="button"
            className="btn btn-ghost"
            disabled={refreshing}
            onClick={() => void refreshAll()}
          >
            <Gi icon={RefreshCw} size={13} />
            {refreshing ? "Refreshing…" : "Refresh now"}
          </button>
        ) : null}
      </div>
    </>
  );
}

/* ── Keyboard shortcuts ──────────────────────────────────────────────── */

/** The shortcuts this app actually binds (grep the keydown handlers before adding one). */
const SHORTCUTS: [string, [string, string[]][]][] = [
  [
    "General",
    [
      ["Command palette", ["⌘", "K"]],
      ["Commands in the palette", [">"]],
      ["Channels / people in the palette", ["#", "@"]],
      ["New task", ["N"]],
      ["Toggle sidebar", ["⌘", "\\"]],
      ["Toggle sidebar (gr8r)", ["["]],
    ],
  ],
  [
    "Tasks",
    [
      ["Next / previous task", ["J", "K"]],
      ["Triage: accept", ["1"]],
      ["Triage: decline", ["2"]],
    ],
  ],
  [
    "Planner",
    [
      ["Day view", ["D"]],
      ["Week view", ["W"]],
      ["Month view", ["M"]],
      ["Year view", ["Y"]],
    ],
  ],
];

export function ShortcutsSection() {
  return (
    <>
      <SetHead title="Keyboard shortcuts" lead="Move faster with the keyboard." />
      {SHORTCUTS.map(([g, list]) => (
        <div key={g} className="sblock" style={{ marginTop: 18 }}>
          <h2>{g}</h2>
          {list.map(([n, keys]) => (
            <div key={n} className="srow" style={{ padding: "9px 0" }}>
              <span>{n}</span>
              <span className="row" style={{ gap: 4 }}>
                {keys.map((k) => (
                  <kbd key={k}>{k}</kbd>
                ))}
              </span>
            </div>
          ))}
        </div>
      ))}
    </>
  );
}
