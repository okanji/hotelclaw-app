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
import Link from "next/link";
import { Gi } from "@/components/gr8r/icon";
import { Av } from "@/components/gr8r/home-glyphs";
import { RoleBadge } from "@/components/gr8r/members-shared";
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

  // gr8r `pageTeam` members panel: `.panel` › `.panel-h`, one `.mini` per
  // person (avatar, name → profile, role badge), hover remove.
  return (
    <section className="panel">
      <div className="panel-h">
        <h2>Members</h2>
        <span className="faint">{roster.length}</span>
        <span className="sp" />
        <Popover>
          <PopoverTrigger
            render={<button type="button" className="btn btn-secondary btn-sm" />}
          >
            <Gi icon={Plus} size={13} />
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
                <li className="px-2 py-3 text-center text-xs text-faint-foreground">
                  Everyone&apos;s already here
                </li>
              ) : (
                candidates.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => void add(p.id)}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent"
                    >
                      <Avatar className="size-6">
                        {p.avatarUrl ? (
                          <AvatarImage src={p.avatarUrl} alt="" />
                        ) : null}
                        <AvatarFallback className="text-xs">
                          {initials(p.name)}
                        </AvatarFallback>
                      </Avatar>
                      <span className="min-w-0 flex-1 truncate">
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
        <div className="panel-b faint">No one assigned to this team yet.</div>
      ) : (
        roster.map((p) => (
          <div key={p.id} className="mini" style={{ minHeight: 48 }}>
            <Av member={p} size="md" />
            <Link
              href={`/p/${propertyId}/members/${p.id}`}
              className="grow"
              style={{ minWidth: 0 }}
            >
              <div className="trunc" style={{ fontWeight: 500 }}>
                {p.name ?? "Unnamed"}
              </div>
              {p.email ? (
                <div className="faint trunc" style={{ fontSize: 12 }}>
                  {p.email}
                </div>
              ) : null}
            </Link>
            <RoleBadge role={p.role} />
            <button
              type="button"
              className="ibtn ibtn-sm"
              aria-label={`Remove ${p.name ?? "member"} from this team`}
              title="Remove from team"
              onClick={() => void remove(p.id)}
            >
              <Gi icon={X} size={14} />
            </button>
          </div>
        ))
      )}
    </section>
  );
}

function initials(name: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}
