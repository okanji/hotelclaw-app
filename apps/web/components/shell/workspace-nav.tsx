"use client";

import { Suspense, useMemo, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { workflowsListQueryOptions } from "@/lib/query/workflow-queries";
import { pendingBookingsCountQueryOptions } from "@/lib/query/booking-queries";
import { pendingApprovalsCountQueryOptions } from "@/lib/query/fleet-queries";
import { CalendarSection } from "@/components/calendar/calendar-section";
import { AppLauncher, type NavBadges } from "./app-launcher";
import { NavNode, target } from "./nav-node";
import {
  NAV_APPS,
  NAV_APP_BY_ID,
  appForPath,
  DEFAULT_PINS,
  type NavApp,
  type NavAppId,
} from "./nav-apps";
import { useNavPrefs } from "./use-nav-prefs";
import { useStoredToggle } from "./use-stored-toggle";
import {
  usePrewarmSections,
  useSectionNavigation,
  type SectionTarget,
} from "./use-section-navigation";
import { InsightsSection } from "./sections/insights-section";
import { TasksSection } from "./sections/tasks-section";
import { MeetingsSection } from "./sections/meetings-section";
import { WorkflowsSection } from "./sections/workflows-section";
import { ChatbotsSection } from "./sections/chatbots-section";
import { AgentsSection } from "./sections/agents-section";
import { BookingsSection } from "./sections/bookings-section";
import { FormsSection } from "./sections/forms-section";

/**
 * The "Workspace" group — ONLY the apps this person pinned, then "More".
 *
 * Every peer converges here: Slack's rail holds five tabs and folds the rest
 * into "Agents & tools"; ClickUp's rail shows a few pinned apps and a "More"
 * grid with "Customize navigation"; Linear's Workspace group ends in a
 * "More" popover with "Customize sidebar". So the sidebar carries the daily
 * shared spaces (default: Home, Tasks, Planner — Chat and Docs sit in the
 * personal block under Assistant) and every other app — Insights, Bookings,
 * Meetings, Forms, Workflows, Chatbots, Agents, Initiatives, Org chart,
 * Archive — is one click away in
 * the More menu (`app-launcher.tsx` — only the UNPINNED apps, Linear's
 * popover), pinnable from Customize.
 *
 * An unpinned app you're currently IN still gets a row (at the end), so the
 * lit row always tells you where you are. The "Workspace" label folds the
 * group (Linear's "Workspace ▾"); the choice persists per device.
 */
export function WorkspaceNav({
  propertyId,
  userId,
  isManagement,
}: {
  propertyId: string;
  userId: string;
  isManagement: boolean;
}) {
  const base = `/p/${propertyId}`;
  const router = useRouter();
  const [open, toggleOpen] = useStoredToggle("hotelclaw:workspace-open", true);
  const { navigate, pathname } = useSectionNavigation(propertyId);
  const prefs = useNavPrefs(DEFAULT_PINS);

  // Amber dot on Workflows while any enabled workflow's most recent run
  // failed — ambient "an automation needs attention" without a count.
  const { data: workflows } = useQuery(workflowsListQueryOptions(propertyId));
  const failingWorkflows = useMemo(
    () =>
      (workflows ?? []).filter((w) => w.enabled && w.last_run_status === "failed")
        .length,
    [workflows],
  );
  // Pending chatbot bookings (the front desk's "needs a yes" number) and
  // fleet approvals. Their realtime invalidation lives in the section bodies,
  // so while those apps are unpinned the counts refresh on focus/refetch.
  const { data: pendingBookings = 0 } = useQuery(
    pendingBookingsCountQueryOptions(propertyId),
  );
  const { data: pendingApprovals = 0 } = useQuery(
    pendingApprovalsCountQueryOptions(propertyId),
  );
  const badges: NavBadges = {
    bookings: { count: pendingBookings },
    agents: { count: pendingApprovals },
    workflows: { dot: failingWorkflows > 0 },
  };

  // Section targets keep their historical route keys.
  const targets = useMemo(() => {
    const map = new Map<NavAppId, SectionTarget>();
    for (const app of NAV_APPS) {
      if (app.section) {
        map.set(
          app.id,
          target(base, app.section, app.path, app.path),
        );
      }
    }
    return map;
  }, [base]);
  const targetFor = (app: NavApp) => targets.get(app.id) ?? null;

  // Pinned apps, plus the app the route is in when it isn't pinned.
  const current = appForPath(propertyId, pathname);
  const rows = useMemo(() => {
    const ids = [...prefs.pins];
    if (current && !ids.includes(current)) ids.push(current);
    return ids
      .map((id) => NAV_APP_BY_ID.get(id))
      .filter((a): a is NavApp => !!a);
  }, [prefs.pins, current]);

  const prewarm = useMemo(
    () =>
      rows
        .map((app) => targets.get(app.id))
        .filter((t): t is SectionTarget => !!t),
    [rows, targets],
  );
  usePrewarmSections(propertyId, userId, prewarm);

  function openApp(app: NavApp) {
    const t = targetFor(app);
    if (t) navigate(t);
    else router.push(`${base}${app.path}`);
  }

  function body(id: NavAppId): ReactNode {
    switch (id) {
      case "tasks":
        return (
          <Suspense fallback={null}>
            <TasksSection propertyId={propertyId} />
          </Suspense>
        );
      case "calendar":
        return <CalendarSection propertyId={propertyId} />;
      // Management reads the property through lenses; staff get their
      // personal "My week" — a plain row.
      case "insights":
        return isManagement ? <InsightsSection propertyId={propertyId} isManagement /> : null;
      case "bookings":
        return (
          <Suspense fallback={null}>
            <BookingsSection propertyId={propertyId} />
          </Suspense>
        );
      case "meetings":
        return <MeetingsSection propertyId={propertyId} />;
      case "forms":
        return (
          <Suspense fallback={null}>
            <FormsSection propertyId={propertyId} />
          </Suspense>
        );
      case "workflows":
        return (
          <Suspense fallback={null}>
            <WorkflowsSection propertyId={propertyId} />
          </Suspense>
        );
      case "chatbots":
        return (
          <Suspense fallback={null}>
            <ChatbotsSection propertyId={propertyId} />
          </Suspense>
        );
      case "agents":
        return (
          <Suspense fallback={null}>
            <AgentsSection propertyId={propertyId} />
          </Suspense>
        );
      default:
        return null;
    }
  }

  return (
    <SidebarGroup>
      <SidebarGroupLabel
        render={<button type="button" />}
        onClick={toggleOpen}
        aria-expanded={open}
        className="w-full cursor-pointer rounded-md hover:bg-sidebar-accent"
      >
        <span className="flex-1 text-left">Workspace</span>
      </SidebarGroupLabel>
      <SidebarGroupAction
        onClick={toggleOpen}
        aria-label={open ? "Collapse workspace" : "Expand workspace"}
      >
        <ChevronRight className={cn("transition-transform", open && "rotate-90")} />
      </SidebarGroupAction>
      {open ? (
      <SidebarGroupContent>
        <SidebarMenu>
          {rows.map((app) => {
            const t = targetFor(app);
            const label = app.id === "insights" && !isManagement ? "My week" : app.label;
            const badge = badges[app.id];
            if (t) {
              return (
                <NavNode
                  key={app.id}
                  item={t}
                  label={label}
                  icon={app.icon}
                  count={badge?.count}
                  dot={badge?.dot}
                  active={current === app.id}
                  navigate={navigate}
                >
                  {body(app.id)}
                </NavNode>
              );
            }
            return (
              <SidebarMenuItem key={app.id}>
                <SidebarMenuButton
                  render={<Link href={`${base}${app.path}`} />}
                  isActive={current === app.id}
                  tooltip={label}
                >
                  <app.icon />
                  <span>{label}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
          <AppLauncher prefs={prefs} badges={badges} onOpenApp={openApp} />
        </SidebarMenu>
      </SidebarGroupContent>
      ) : null}
    </SidebarGroup>
  );
}
