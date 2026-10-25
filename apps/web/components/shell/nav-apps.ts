import type { ComponentType } from "react";
import {
  Archive,
  Bot,
  CalendarDays,
  ClipboardList,
  FileText,
  Home,
  LineChart,
  ListChecks,
  MessagesSquare,
  Network,
  Sparkles,
  Target,
  Ticket,
  Video,
  Workflow,
} from "lucide-react";
import type { TintTone } from "@/components/ui/tint-card";
import type { ShellSection } from "./shell-section-context";

/**
 * Every product area the sidebar can show, in launcher order. The sidebar
 * pins a SHORT list of these (Slack caps its rail at five tabs; ClickUp and
 * Linear pin a handful and fold the rest behind "More"); everything else
 * lives in the More launcher, and "Customize sidebar" moves apps between the
 * two. Pins are a per-person preference (`use-nav-prefs.ts`).
 *
 * `section` apps are full sidebar nodes (their section body nests under the
 * row); the rest are plain destinations.
 */
export type NavAppId =
  | "home"
  | "tasks"
  | "chat"
  | "calendar"
  | "docs"
  | "meetings"
  | "bookings"
  | "insights"
  | "initiatives"
  | "forms"
  | "workflows"
  | "chatbots"
  | "agents"
  | "org"
  | "archive";

export type NavApp = {
  id: NavAppId;
  label: string;
  /** One line for the launcher tile's tooltip and the Customize dialog. */
  hint: string;
  icon: ComponentType<{ className?: string }>;
  /** Path under `/p/<pid>`. */
  path: string;
  /** Set when the app is a shell section (gets a NavNode + resume). */
  section?: ShellSection;
  /** Launcher tile color (brand tint palette — never a hex). */
  tone: TintTone;
  /** Launcher grouping: day-to-day work vs. building/automating vs. admin. */
  group: "work" | "build" | "admin";
};

export const NAV_APPS: NavApp[] = [
  { id: "home", label: "Home", hint: "Your property dashboard", icon: Home, path: "/home", section: "home", tone: "lavender", group: "work" },
  { id: "tasks", label: "Tasks", hint: "Board, triage and cycles", icon: ListChecks, path: "/tasks", section: "tasks", tone: "blue", group: "work" },
  { id: "chat", label: "Chat", hint: "Channels, DMs and mentions", icon: MessagesSquare, path: "/chat", section: "chat", tone: "sage", group: "work" },
  { id: "calendar", label: "Planner", hint: "Calendar and scheduling", icon: CalendarDays, path: "/calendar", section: "calendar", tone: "coral", group: "work" },
  { id: "docs", label: "Docs", hint: "SOPs, notes and sheets", icon: FileText, path: "/documents", section: "docs", tone: "honey", group: "work" },
  { id: "bookings", label: "Bookings", hint: "Reservations, tables and tickets", icon: Ticket, path: "/bookings", section: "bookings", tone: "lavender", group: "work" },
  { id: "meetings", label: "Meetings", hint: "Calls, recordings and notes", icon: Video, path: "/meetings", section: "meetings", tone: "blue", group: "work" },
  { id: "insights", label: "Insights", hint: "Dashboards, reports and briefs", icon: LineChart, path: "/home/insights", section: "insights", tone: "sage", group: "work" },
  { id: "initiatives", label: "Initiatives", hint: "Goals that group projects", icon: Target, path: "/initiatives", tone: "coral", group: "work" },
  { id: "forms", label: "Forms", hint: "Checklists, requests and surveys", icon: ClipboardList, path: "/forms", section: "forms", tone: "honey", group: "build" },
  { id: "workflows", label: "Workflows", hint: "Automations across the app", icon: Workflow, path: "/workflows", section: "workflows", tone: "lavender", group: "build" },
  { id: "chatbots", label: "Chatbots", hint: "Guest-facing assistants", icon: Bot, path: "/chatbots", section: "chatbots", tone: "blue", group: "build" },
  { id: "agents", label: "Agents", hint: "Internal AI agents and memory", icon: Sparkles, path: "/agents", section: "agents", tone: "sage", group: "build" },
  { id: "org", label: "Org chart", hint: "Teams, leads and reporting lines", icon: Network, path: "/home/org", tone: "coral", group: "admin" },
  { id: "archive", label: "Archive", hint: "Archived projects and teams", icon: Archive, path: "/archive", tone: "honey", group: "admin" },
];

export const NAV_APP_BY_ID = new Map(NAV_APPS.map((a) => [a.id, a]));

export const NAV_GROUP_LABEL: Record<NavApp["group"], string> = {
  work: "Work",
  build: "Build & automate",
  admin: "Admin",
};

/**
 * Fresh-sidebar pins: the daily drivers. Five, like Slack's rail — Insights
 * is added for management (their daily read), Bookings/Meetings and the
 * build tools wait in the launcher until someone pins them.
 */
export function defaultPins(isManagement: boolean): NavAppId[] {
  const pins: NavAppId[] = ["home", "tasks", "chat", "calendar", "docs"];
  if (isManagement) pins.push("insights");
  return pins;
}

/** The app a pathname belongs to — so an unpinned app you're IN still shows. */
export function appForPath(propertyId: string, pathname: string): NavAppId | null {
  const rest = pathname.slice(`/p/${propertyId}`.length);
  if (rest.startsWith("/home/org")) return "org";
  if (rest.startsWith("/home/insights")) return "insights";
  if (rest.startsWith("/initiatives")) return "initiatives";
  if (rest.startsWith("/archive")) return "archive";
  // Routes that live under another app's node.
  if (/^\/(dms|inbox|threads)(\/|$)/.test(rest)) return "chat";
  if (/^\/(triage|cycles)(\/|$)/.test(rest)) return "tasks";
  // Longest-prefix match over the remaining apps.
  let best: NavApp | null = null;
  for (const app of NAV_APPS) {
    if (rest === app.path || rest.startsWith(`${app.path}/`)) {
      if (!best || app.path.length > best.path.length) best = app;
    }
  }
  return best?.id ?? null;
}
