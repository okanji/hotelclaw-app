"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardList, LayoutList, Plus, Sparkles } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { formsListQueryOptions } from "@/lib/query/section-queries";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

/**
 * Secondary sidebar for the Forms section (ClickUp-style forms hub): create
 * entry points up top — New form and the AI draft flow, both handled by the
 * forms index page via `?new=1` / `?ai=1` — then one row per form. Draft
 * forms sit in faint ink (same rung as paused booking services). Realtime on
 * `forms` (migration 0100) keeps the list live across sessions.
 */
export function FormsSection({ propertyId }: { propertyId: string }) {
  const pathname = usePathname();
  const qc = useQueryClient();
  const base = `/p/${propertyId}/forms`;

  const { data: forms = [] } = useQuery(formsListQueryOptions(propertyId));

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`forms-list:${propertyId}:${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "forms",
          filter: `property_id=eq.${propertyId}`,
        },
        () => {
          void qc.invalidateQueries({ queryKey: ["forms", propertyId] });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [propertyId, qc]);

  return (
    <>
      <SidebarGroup>
        <SidebarGroupLabel>Forms</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                render={<Link href={base} />}
                isActive={pathname === base}
                tooltip="All forms & responses"
              >
                <LayoutList />
                <span>All forms</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                render={<Link href={`${base}?new=1`} />}
                tooltip="New form"
              >
                <Plus />
                <span>New form</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                render={<Link href={`${base}?ai=1`} />}
                tooltip="Describe the form you need and AI drafts it"
              >
                <Sparkles />
                <span>Draft with AI</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      {forms.length > 0 ? (
        <SidebarGroup>
          <SidebarGroupLabel>Your forms</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {forms.map((f) => {
                const href = `${base}/${f.id}`;
                return (
                  <SidebarMenuItem key={f.id}>
                    <SidebarMenuButton
                      render={<Link href={href} />}
                      isActive={pathname.startsWith(href)}
                      tooltip={f.title || "Untitled form"}
                      className={
                        f.status === "draft" ? "text-faint-foreground" : undefined
                      }
                    >
                      {f.icon ? (
                        <span aria-hidden="true">{f.icon}</span>
                      ) : (
                        <ClipboardList />
                      )}
                      <span className="truncate">{f.title || "Untitled form"}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      ) : null}
    </>
  );
}
