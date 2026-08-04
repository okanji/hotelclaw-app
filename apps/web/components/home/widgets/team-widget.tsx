"use client";

import { useQuery } from "@tanstack/react-query";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { propertyMembersQueryOptions } from "@/lib/query/section-queries";
import { ROW_CLASS, WidgetEmpty } from "../editorial-section";

const ROLE_LABEL: Record<string, string> = {
  owner: "Owner",
  manager: "Manager",
  staff: "Staff",
};

const SHOWN = 7;

/** Company-wide roster: the property's members with role + a head count. */
export function TeamWidget({ propertyId }: { propertyId: string }) {
  const { data: members = [], isPending } = useQuery(
    propertyMembersQueryOptions(propertyId),
  );

  if (isPending) return <WidgetEmpty>Loading the team…</WidgetEmpty>;
  if (members.length === 0) return <WidgetEmpty>No teammates yet.</WidgetEmpty>;

  const shown = members.slice(0, SHOWN);
  const extra = members.length - shown.length;

  return (
    <ul
      role="list"
      className="-mx-2 flex flex-col divide-y divide-border border-t border-border"
    >
      {shown.map((m) => (
        <li key={m.id} className={ROW_CLASS}>
          <Avatar className="size-7">
            {m.avatarUrl ? <AvatarImage src={m.avatarUrl} alt="" /> : null}
            <AvatarFallback className="text-xs">
              {initials(m.name)}
            </AvatarFallback>
          </Avatar>
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
            {m.name || "Unnamed"}
          </span>
          <span className="shrink-0 text-xs text-faint-foreground">
            {ROLE_LABEL[m.role] ?? m.role}
          </span>
        </li>
      ))}
      {extra > 0 ? (
        <li className="px-2 py-1.5 text-xs text-faint-foreground tabular-nums">
          +{extra} more
        </li>
      ) : null}
    </ul>
  );
}

function initials(name: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}
