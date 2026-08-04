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
          // 6px control radius, no lift on hover (notion-spec §4/§6) — the
          // tile's own tint is the affordance.
          "flex size-8 items-center justify-center rounded-md text-sm font-medium uppercase outline-hidden",
          "focus-visible:shadow-focus",
          propertyTileTint(currentPropertyId),
        )}
      >
        {propertyInitial(name)}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="right"
        align="start"
        sideOffset={8}
        className="min-w-64 p-1"
      >
        <DropdownMenuGroup>
          {/* Section label: 12px/12px weight 500 faint, sentence case, no
              tracking (notion-spec §3). */}
          <DropdownMenuLabel className="px-1.5 pt-1 pb-1.5 text-xs leading-3 font-medium text-faint-foreground">
            Organizations
          </DropdownMenuLabel>
          {memberships.map((m) => {
            const isActive = m.property_id === currentPropertyId;
            return (
              <DropdownMenuItem
                key={m.property_id}
                onClick={() => router.push(`/p/${m.property_id}/home`)}
                // One quiet line per org — the role reads as a faint suffix
                // rather than a second line, so rows stay on the 28px pitch.
                className={cn("gap-2", isActive && "bg-accent")}
              >
                <span
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-md text-xs font-medium uppercase",
                    propertyTileTint(m.property_id),
                  )}
                >
                  {propertyInitial(m.property.name)}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {m.property.name}
                </span>
                <span className="shrink-0 text-xs text-faint-foreground capitalize">
                  {m.role}
                </span>
                {isActive ? (
                  <Check className="size-3.5 shrink-0 text-faint-foreground" />
                ) : null}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => router.push("/onboarding?add=1")}
          className="gap-2"
        >
          <Plus className="size-4 text-faint-foreground" />
          Add organization
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
