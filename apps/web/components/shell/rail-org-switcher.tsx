"use client";

import { useRouter } from "next/navigation";
import { Check, Plus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { propertyInitial, propertyTileTint } from "@/lib/shell/property-avatar";
import type { Membership } from "@/lib/auth/session";

/**
 * The rail's org mark: the current property's colored-initial tile, doubling
 * as a workspace switcher. Clicking it opens a compact property picker —
 * switch org or add a new one. Deliberately reachable from the rail (not just
 * the sidebar switcher) so org-switching survives a collapsed sidebar.
 */
export function RailOrgSwitcher({
  currentPropertyId,
  memberships,
}: {
  currentPropertyId: string;
  memberships: Membership[];
}) {
  const router = useRouter();
  const current = memberships.find((m) => m.property_id === currentPropertyId);
  const name = current?.property.name ?? "Property";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`${name} — switch organization`}
        title={name}
        className={cn(
          "flex size-10 items-center justify-center rounded-xl text-sm font-semibold uppercase outline-hidden transition-transform",
          "hover:scale-[1.04] focus-visible:ring-2 focus-visible:ring-black/15 dark:focus-visible:ring-white/40",
          propertyTileTint(currentPropertyId),
        )}
      >
        {propertyInitial(name)}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="right"
        align="start"
        sideOffset={8}
        className="min-w-64 p-1.5"
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel className="px-2 pt-1 pb-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Organizations
          </DropdownMenuLabel>
          {memberships.map((m) => {
            const isActive = m.property_id === currentPropertyId;
            return (
              <DropdownMenuItem
                key={m.property_id}
                onClick={() => router.push(`/p/${m.property_id}/home`)}
                className={cn("gap-2.5 px-2 py-2", isActive && "bg-accent/60")}
              >
                <span
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-lg text-xs font-semibold uppercase",
                    propertyTileTint(m.property_id),
                  )}
                >
                  {propertyInitial(m.property.name)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-foreground">
                    {m.property.name}
                  </div>
                  <div className="text-xs text-muted-foreground capitalize">
                    {m.role}
                  </div>
                </div>
                {isActive ? (
                  <Check className="size-4 shrink-0 text-primary" />
                ) : null}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => router.push("/onboarding?add=1")}
          className="gap-2.5 px-2 py-1.5"
        >
          <Plus className="size-4 text-muted-foreground" />
          Add organization
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
