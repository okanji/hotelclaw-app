"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { IterationCw, ListFilter } from "lucide-react";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import {
  triageCountQueryOptions,
  useTriageRealtime,
} from "@/lib/query/triage-queries";
import {
  cycleScopes,
  cyclesQueryOptions,
} from "@/lib/query/cycle-queries";

/**
 * The Tasks node's children — Linear's team planning rows only: Triage (the
 * intake queue, with its pending count) and Cycles (plus the current cycle of
 * each cadence). Everything else that used to sit here moved to where it
 * belongs: the Tasks row itself opens the board; "Assigned to me" is My tasks
 * in the personal block; create is the header's + New (and `N`); team and
 * project scoping is the board toolbar's Filter and the Teams / Projects
 * groups, whose workspace views deep-link `?space=` / `?project=`.
 */
export function TasksSection({ propertyId }: { propertyId: string }) {
  const pathname = usePathname();

  // Live pending count; the realtime hook keeps it (and the queue) fresh.
  useTriageRealtime(propertyId);
  const { data: triageCount = 0 } = useQuery(triageCountQueryOptions(propertyId));
  const triageHref = `/p/${propertyId}/triage`;

  // One "current cycle" row per enabled cadence (property-wide first).
  const { data: scopes = [] } = useQuery({
    ...cyclesQueryOptions(propertyId),
    select: cycleScopes,
  });
  const cyclesBase = `/p/${propertyId}/cycles`;
  const cycleId = pathname.match(/\/cycles\/([^/?]+)/)?.[1];

  return (
    <SidebarGroup>
      <SidebarGroupContent>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              render={<Link href={triageHref} />}
              isActive={pathname.startsWith(triageHref)}
              tooltip="Triage"
            >
              <ListFilter />
              <span className="flex-1">Triage</span>
              {triageCount > 0 ? (
                <span className="shrink-0 text-xs font-medium tabular-nums text-faint-foreground">
                  {triageCount > 99 ? "99+" : triageCount}
                </span>
              ) : null}
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              render={<Link href={cyclesBase} />}
              isActive={pathname === cyclesBase}
              tooltip="Cycles"
            >
              <IterationCw />
              <span>Cycles</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          {scopes
            .filter((s) => s.current)
            .map((s) => (
              <SidebarMenuItem key={s.spaceId ?? "property"}>
                <SidebarMenuButton
                  render={<Link href={`${cyclesBase}/${s.current!.id}`} />}
                  isActive={cycleId === s.current!.id}
                  tooltip="Current cycle"
                  className="pl-8 text-[13px]"
                >
                  <span className="truncate">
                    {s.current!.name ?? `Cycle ${s.current!.number}`}
                    {scopes.length > 1 ? (
                      <span className="text-faint-foreground"> · current</span>
                    ) : null}
                  </span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
