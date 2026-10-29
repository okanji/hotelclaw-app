"use client";

import { Fragment, useEffect, useState } from "react";
import {
  Bell,
  Building2,
  CalendarDays,
  Clock,
  IterationCcw,
  KeyRound,
  LineChart,
  Keyboard,
  Mail,
  Palette,
  PanelLeft,
  Settings,
  Sparkles,
  User,
  UserRoundPlus,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Gi } from "@/components/gr8r/icon";
import { PageHeader } from "@/components/shell/page-header";
import { useSurfacePathname } from "@/lib/shell/use-surface-pathname";
import type { CycleSettingsRow } from "@/lib/cycles/types";
import { AppearancePrefs } from "./appearance-prefs";
import {
  AppearanceSection,
  CalendarsSection,
  DateTimeSection,
  ProfileSection,
  ShortcutsSection,
  SidebarSection,
} from "./settings-personal";
import {
  DesktopNotificationsSection,
  EmailNotificationsSection,
  InsightFollowsSection,
} from "./settings-notifications";
import {
  ApiAccessSection,
  CyclesSection,
  GuestsSection,
  MembersSection,
  TriageSection,
  WorkspaceSection,
  type SettingsProperty,
} from "./settings-workspace";

/**
 * Settings — gr8r-studio's `pageSettings` (src/pages/settings.js): `.set`
 * grid of a grouped `.set-nav` (`.gh` headings + `.sitem` rows) beside a
 * scrolling `.set-body › .set-in` whose sections open with `h1` + `p.lead`
 * and are built from `.srow` / `.sblock`. The SECTIONS are ours: every row
 * reads or writes a real setting, reusing the existing actions / routes.
 *
 * gr8r sections with no equivalent here are left out rather than faked:
 * Language, Permissions toggles, Projects defaults, Teams grid, Preferences
 * (open-on-launch / open-tasks-in), Password, Sessions, Two-factor, Plan,
 * Payment, Invoices.
 */

type SectionId =
  | "workspace"
  | "appearance"
  | "datetime"
  | "members"
  | "guests"
  | "cycles"
  | "triage"
  | "api"
  | "notif-desktop"
  | "notif-email"
  | "notif-insights"
  | "profile"
  | "sidebar"
  | "calendars"
  | "shortcuts";

type NavItem = { id: SectionId; label: string; icon: LucideIcon; management?: boolean };

const SET_NAV: [string, NavItem[]][] = [
  [
    "General",
    [
      { id: "workspace", label: "Workspace", icon: Building2, management: true },
      { id: "appearance", label: "Appearance", icon: Palette },
      { id: "datetime", label: "Date & time", icon: Clock },
    ],
  ],
  [
    "Workspace",
    [
      { id: "members", label: "Members", icon: Users, management: true },
      { id: "guests", label: "Guests", icon: UserRoundPlus, management: true },
      { id: "cycles", label: "Cycles", icon: IterationCcw, management: true },
      { id: "triage", label: "AI triage", icon: Sparkles, management: true },
      { id: "api", label: "API access", icon: KeyRound, management: true },
    ],
  ],
  [
    "Notifications",
    [
      { id: "notif-desktop", label: "Desktop", icon: Bell },
      { id: "notif-email", label: "Email", icon: Mail },
      { id: "notif-insights", label: "Insights", icon: LineChart, management: true },
    ],
  ],
  [
    "Personal",
    [
      { id: "profile", label: "Profile", icon: User },
      { id: "sidebar", label: "Sidebar", icon: PanelLeft },
      { id: "calendars", label: "Calendar accounts", icon: CalendarDays },
      { id: "shortcuts", label: "Keyboard shortcuts", icon: Keyboard },
    ],
  ],
];

const ALL_IDS = new Set<string>(SET_NAV.flatMap(([, items]) => items.map((i) => i.id)));

export type SettingsViewProps = {
  propertyId: string;
  initialSection: string | null;
  role: string | null;
  user: { id: string; email: string; name: string | null; avatarUrl: string | null };
  property: SettingsProperty;
  cadences: CycleSettingsRow[];
};

function visibleNav(manage: boolean) {
  return SET_NAV.map(
    ([g, items]) => [g, items.filter((i) => manage || !i.management)] as const,
  ).filter(([, items]) => items.length > 0);
}

function resolveSection(raw: string | null, manage: boolean): SectionId {
  if (raw && ALL_IDS.has(raw)) {
    const item = SET_NAV.flatMap(([, i]) => i).find((i) => i.id === raw);
    if (item && (manage || !item.management)) return item.id;
  }
  return "appearance";
}

const IN_SETTINGS = /^\/p\/[^/]+\/settings(?:\/|$)/;

export function SettingsView(props: SettingsViewProps) {
  const pathname = useSurfacePathname();
  // A pushState hop to a persistent section must not leave this painted.
  if (!IN_SETTINGS.test(pathname)) return null;
  return <SettingsBody {...props} />;
}

function SettingsBody({
  propertyId,
  initialSection,
  role,
  user,
  property,
  cadences,
}: SettingsViewProps) {
  const manage = role === "owner" || role === "manager";
  const isOwner = role === "owner";
  const [sec, setSec] = useState<SectionId>(() => resolveSection(initialSection, manage));
  const nav = visibleNav(manage);

  // Back / forward between sections.
  useEffect(() => {
    const onPop = () => {
      const raw = new URLSearchParams(window.location.search).get("sec");
      setSec(resolveSection(raw, manage));
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [manage]);

  function go(next: SectionId) {
    setSec(next);
    // Shallow — no server round-trip per section; the URL stays shareable.
    const url = new URL(window.location.href);
    url.searchParams.set("sec", next);
    window.history.pushState(null, "", url);
    document.querySelector(".set-body")?.scrollTo({ top: 0 });
  }

  let body: React.ReactNode;
  switch (sec) {
    case "workspace":
      body = <WorkspaceSection key={`${property.name}|${property.timezone}|${property.taskPrefix}`} property={property} />;
      break;
    case "appearance":
      body = <AppearanceSection />;
      break;
    case "datetime":
      body = (
        <DateTimeSection
          timezone={property.timezone}
          canManage={manage}
          onGoWorkspace={() => go("workspace")}
        />
      );
      break;
    case "members":
      body = (
        <MembersSection
          propertyId={propertyId}
          propertyName={property.name}
          isOwner={isOwner}
          currentEmail={user.email}
        />
      );
      break;
    case "guests":
      body = <GuestsSection propertyId={propertyId} />;
      break;
    case "cycles":
      body = <CyclesSection propertyId={propertyId} cadences={cadences} />;
      break;
    case "triage":
      body = <TriageSection propertyId={propertyId} />;
      break;
    case "api":
      body = <ApiAccessSection propertyId={propertyId} isOwner={isOwner} isPod={property.isPod} />;
      break;
    case "notif-desktop":
      body = <DesktopNotificationsSection propertyId={propertyId} />;
      break;
    case "notif-email":
      body = <EmailNotificationsSection />;
      break;
    case "notif-insights":
      body = <InsightFollowsSection propertyId={propertyId} />;
      break;
    case "profile":
      body = <ProfileSection user={user} />;
      break;
    case "sidebar":
      body = <SidebarSection />;
      break;
    case "calendars":
      body = <CalendarsSection propertyId={propertyId} />;
      break;
    case "shortcuts":
      body = <ShortcutsSection />;
      break;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Applies accent / density / motion while Settings is open, even
          before the shell mounts its own instance. */}
      <AppearancePrefs />
      <PageHeader title="Settings" icon={<Settings />} />
      <div className="set h-auto min-h-0 flex-1">
        <nav className="set-nav" aria-label="Settings">
          {nav.map(([g, items]) => (
            <Fragment key={g}>
              <div className="gh">{g}</div>
              {items.map((i) => (
                <button
                  key={i.id}
                  type="button"
                  className={`sitem${sec === i.id ? " on" : ""}`}
                  aria-current={sec === i.id ? "page" : undefined}
                  onClick={() => go(i.id)}
                >
                  <Gi icon={i.icon} size={15} />
                  <span>{i.label}</span>
                </button>
              ))}
            </Fragment>
          ))}
        </nav>
        <div className="set-body">
          <div className="set-in">{body}</div>
        </div>
      </div>
    </div>
  );
}
