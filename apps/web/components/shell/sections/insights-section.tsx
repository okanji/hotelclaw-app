"use client";

import { Cog, FileText, FolderKanban, Sparkles } from "lucide-react";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useSurfacePathname } from "@/lib/shell/use-surface-pathname";
import {
  useInsightsTab,
  type InsightDashTab,
} from "@/components/insights/insights-tab-context";

const REPORTS_ROUTE = /\/home\/insights\/reports\/?$/;

const DASH_ICON: Record<InsightDashTab, typeof Sparkles> = {
  overview: Sparkles,
  work: FolderKanban,
  operations: Cog,
};

/**
 * Secondary sidebar for the Insights section. Lists the views the way every
 * other section navigates — Overview / Work / Operations up top, Reports below.
 * The dashboard tabs are shared client state (`useInsightsTab`), so a click here
 * swaps the surface with no navigation; Reports is a real route so it can be
 * deep-linked (notifications, the intelligence cards) — a click pushes its URL.
 * Operations and Reports are property-level, hidden while the surface is lensed
 * to a project / team / person. Staff never see tabs — the whole surface is
 * their personal "My week".
 */
export function InsightsSection({
  propertyId,
  isManagement,
}: {
  propertyId: string;
  isManagement: boolean;
}) {
  const pathname = useSurfacePathname();
  const { dashTab, setDashTab, scope } = useInsightsTab();
  const base = `/p/${propertyId}/home/insights`;
  const onReports = REPORTS_ROUTE.test(pathname);
  const isProperty = scope.kind === "property";

  function goReports() {
    if (onReports) return;
    window.history.pushState(null, "", `${base}/reports`);
    window.dispatchEvent(new Event("hotelclaw:pathname"));
  }
  function goDash(tab: InsightDashTab) {
    setDashTab(tab);
    if (onReports) {
      window.history.pushState(null, "", base);
      window.dispatchEvent(new Event("hotelclaw:pathname"));
    }
  }

  if (!isManagement) {
    return (
      <SidebarGroup>
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton isActive tooltip="My week">
                <Sparkles />
                <span>My week</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    );
  }

  const dashViews: { id: InsightDashTab; label: string; propertyOnly?: boolean }[] =
    [
      { id: "overview", label: "Overview" },
      { id: "work", label: "Work" },
      { id: "operations", label: "Operations", propertyOnly: true },
    ];

  return (
    <>
      <SidebarGroup>
        <SidebarGroupLabel>Insights</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            {dashViews
              .filter((v) => !v.propertyOnly || isProperty)
              .map((v) => {
                const Icon = DASH_ICON[v.id];
                return (
                  <SidebarMenuItem key={v.id}>
                    <SidebarMenuButton
                      render={<button type="button" />}
                      onClick={() => goDash(v.id)}
                      isActive={!onReports && dashTab === v.id}
                      tooltip={v.label}
                    >
                      <Icon />
                      <span>{v.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      {isProperty ? (
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  render={<button type="button" />}
                  onClick={goReports}
                  isActive={onReports}
                  tooltip="Reports"
                >
                  <FileText />
                  <span>Reports</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      ) : null}
    </>
  );
}
