"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Search, X } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { propertyMembersQueryOptions } from "@/lib/query/section-queries";
import { spaceMemberIdsQueryOptions } from "@/lib/query/project-queries";
import { addSpaceMember, removeSpaceMember } from "./actions";

/** Roster of who works in a space, with add/remove from the property's people. */
export function SpaceMembersPanel({
  propertyId,
  spaceId,
}: {
  propertyId: string;
  spaceId: string;
}) {
  const qc = useQueryClient();
  const { data: people = [] } = useQuery(propertyMembersQueryOptions(propertyId));
  const { data: memberIds = [] } = useQuery(
    spaceMemberIdsQueryOptions(spaceId),
  );
  const [q, setQ] = useState("");

  const idSet = useMemo(() => new Set(memberIds), [memberIds]);
  const roster = useMemo(
    () => people.filter((p) => idSet.has(p.id)),
    [people, idSet],
  );
  const candidates = useMemo(
    () =>
      people
        .filter((p) => !idSet.has(p.id))
        .filter((p) =>
          q.trim()
            ? (p.name ?? "").toLowerCase().includes(q.trim().toLowerCase())
            : true,
        )
        .slice(0, 8),
    [people, idSet, q],
  );

  function refresh() {
    void qc.invalidateQueries({ queryKey: ["space-members", spaceId] });
  }
  async function add(userId: string) {
    const res = await addSpaceMember(spaceId, userId);
    if ("error" in res) toast.error(res.error);
    else refresh();
  }
  async function remove(userId: string) {
    const res = await removeSpaceMember(spaceId, userId);
    if ("error" in res) toast.error(res.error);
    else refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[0.8125rem] tracking-tight text-muted-foreground tabular-nums">
          {roster.length} {roster.length === 1 ? "member" : "members"}
        </span>
        <Popover>
          <PopoverTrigger
            render={<Button type="button" size="sm" variant="outline" />}
          >
            <Plus className="size-4" />
            Add members
          </PopoverTrigger>
          <PopoverContent align="end" sideOffset={6} className="w-64 p-2">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search people…"
                className="h-8 pl-8 text-sm"
              />
            </div>
            <ul className="mt-1.5 max-h-56 overflow-y-auto">
              {candidates.length === 0 ? (
                <li className="px-2 py-3 text-center text-xs text-muted-foreground">
                  Everyone&apos;s already here
                </li>
              ) : (
                candidates.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => void add(p.id)}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted"
                    >
                      <Avatar className="size-6">
                        {p.avatarUrl ? (
                          <AvatarImage src={p.avatarUrl} alt="" />
                        ) : null}
                        <AvatarFallback className="text-[0.5625rem]">
                          {initials(p.name)}
                        </AvatarFallback>
                      </Avatar>
                      <span className="min-w-0 flex-1 truncate tracking-tight">
                        {p.name ?? "Unnamed"}
                      </span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          </PopoverContent>
        </Popover>
      </div>

      {roster.length === 0 ? (
        <p className="py-4 text-[0.8125rem] text-muted-foreground">
          No one assigned to this space yet.
        </p>
      ) : (
        <ul
          role="list"
          className="flex flex-col divide-y divide-border/40 border-t border-border/40"
        >
          {roster.map((p) => (
            <li
              key={p.id}
              className="group/row flex items-center gap-3 px-1 py-2.5"
            >
              <Avatar className="size-7">
                {p.avatarUrl ? <AvatarImage src={p.avatarUrl} alt="" /> : null}
                <AvatarFallback className="text-[0.625rem]">
                  {initials(p.name)}
                </AvatarFallback>
              </Avatar>
              <span className="min-w-0 flex-1 truncate text-[0.875rem] tracking-tight text-foreground">
                {p.name ?? "Unnamed"}
              </span>
              <span className="shrink-0 text-[0.75rem] tracking-tight text-muted-foreground capitalize">
                {p.role}
              </span>
              <button
                type="button"
                aria-label={`Remove ${p.name ?? "member"}`}
                onClick={() => void remove(p.id)}
                className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity group-hover/row:opacity-100 hover:bg-destructive/10 hover:text-destructive"
              >
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function initials(name: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}
