"use client";

import { UserRound } from "lucide-react";
import {
  Avatar,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarImage,
} from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import type { AssigneeInfo } from "@/lib/tasks/use-assignees";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/**
 * Every assignee on a task (0115), primary first, as overlapping avatars with
 * a "+N" chip past `max`. Empty → Linear's dashed unassigned glyph. The title
 * lists everyone, so a hover answers "who's on this?" without opening it.
 */
export function AssigneeStack({
  ids,
  infos,
  max = 3,
  size = 22,
  className,
}: {
  ids: string[];
  infos: Record<string, AssigneeInfo | undefined>;
  max?: number;
  /** Avatar diameter in px (22 on cards, 20 in dense rows). */
  size?: 20 | 22;
  className?: string;
}) {
  const box = size === 20 ? "size-5" : "size-[22px]";
  if (ids.length === 0) {
    return (
      <span
        aria-label="Unassigned"
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-full border border-dashed border-muted-foreground/40 text-muted-foreground",
          box,
          className,
        )}
      >
        <UserRound className="size-3" strokeWidth={1.75} />
      </span>
    );
  }
  const names = ids.map((id) => infos[id]?.name ?? "Member");
  const shown = ids.slice(0, ids.length > max ? max - 1 : max);
  const extra = ids.length - shown.length;
  return (
    <AvatarGroup
      className={cn("-space-x-1.5", className)}
      title={`Assigned to ${names.join(", ")}`}
      aria-label={`Assigned to ${names.join(", ")}`}
    >
      {shown.map((id) => {
        const info = infos[id];
        const name = info?.name ?? "Member";
        return (
          <Avatar key={id} size="sm" className={cn(box, "shrink-0")}>
            {info?.avatar ? <AvatarImage src={info.avatar} alt={name} /> : null}
            <AvatarFallback className="bg-muted text-xs font-medium text-foreground">
              {initials(name)}
            </AvatarFallback>
          </Avatar>
        );
      })}
      {extra > 0 ? (
        <AvatarGroupCount
          className={cn(box, "text-xs tabular-nums")}
        >
          +{extra}
        </AvatarGroupCount>
      ) : null}
    </AvatarGroup>
  );
}
