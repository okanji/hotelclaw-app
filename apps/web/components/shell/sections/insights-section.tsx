"use client";

import { Sparkles } from "lucide-react";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

/**
 * Secondary sidebar for the Insights section. The dashboard views
 * (Overview / Work / Operations / Reports) now live in an in-page
 * red-underline tab strip on the surface itself (`InsightsView`), so for
 * management there's nothing section-specific left here — the shared search +
 * property switcher in the sidebar header carry the chrome. Staff never get
 * tabs: the whole surface is their personal "My week", labelled here.
 */
export function InsightsSection({
  isManagement,
}: {
  propertyId: string;
  isManagement: boolean;
}) {
  if (isManagement) return null;

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
