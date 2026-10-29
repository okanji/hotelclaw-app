"use client";

import type { CSSProperties } from "react";
import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Folder, Users } from "lucide-react";
import { Gi } from "@/components/gr8r/icon";
import { AvStack, G8_COLOR } from "./home-glyphs";
import { G8Empty, propertySpaceMembersQueryOptions } from "./members-shared";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import { projectSpacesQueryOptions } from "@/lib/query/project-queries";
import { propertyMembersQueryOptions } from "@/lib/query/section-queries";
import type { EntityColor } from "@/lib/db/types";

type CSSVars = CSSProperties & Record<`--${string}`, string | number>;

export type G8Team = {
  id: string;
  name: string;
  description: string | null;
  color: EntityColor;
  icon: string | null;
  parent_space_id: string | null;
};

/** Teams with their descriptions (the shared `spaces` query omits them). */
export function teamsWithDescQueryOptions(propertyId: string) {
  return {
    queryKey: ["g8-teams", propertyId] as const,
    queryFn: async (): Promise<G8Team[]> => {
      const supabase = createBrowserClient();
      const { data, error } = await supabase
        .from("spaces")
        .select("id, name, description, color, icon, parent_space_id")
        .eq("property_id", propertyId)
        .is("archived_at", null)
        .order("position", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as G8Team[];
    },
  };
}

/** gr8r `.picon` for a team — its emoji, else the Users glyph on its colour. */
export function TeamIcon({
  team,
  lg,
}: {
  team: { color: EntityColor; icon: string | null };
  lg?: boolean;
}) {
  return (
    <span
      className={lg ? "picon lg" : "picon"}
      style={{ "--g8-c": G8_COLOR[team.color] ?? "var(--g8-gray)" } as CSSVars}
      aria-hidden="true"
    >
      {team.icon ? (
        <span style={{ fontSize: lg ? 18 : 15, lineHeight: 1 }}>{team.icon}</span>
      ) : (
        <Gi icon={Users} size={lg ? 18 : 15} />
      )}
    </span>
  );
}

/** gr8r `teamsGrid()` — one `.pcard` per team: icon, name, description, counts, avatars. */
export function TeamsGrid({
  propertyId,
  onNewTeam,
}: {
  propertyId: string;
  onNewTeam?: () => void;
}) {
  const router = useRouter();
  const { data: teams = [], isPending } = useQuery(teamsWithDescQueryOptions(propertyId));
  const { data: people = [] } = useQuery(propertyMembersQueryOptions(propertyId));
  const { data: links = [] } = useQuery(projectSpacesQueryOptions(propertyId));
  const ids = useMemo(() => teams.map((t) => t.id), [teams]);
  const { data: membersBySpace = {} } = useQuery(
    propertySpaceMembersQueryOptions(propertyId, ids),
  );
  const peopleById = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const parentName = useMemo(() => new Map(teams.map((t) => [t.id, t.name])), [teams]);

  if (isPending) return <div className="panel-b faint">Loading teams…</div>;
  if (!teams.length)
    return (
      <div className="panel">
        <G8Empty
          icon={Users}
          title="No teams yet"
          text="Create a team to group people and give projects an owner."
        >
          {onNewTeam ? (
            <button type="button" className="btn btn-primary btn-sm" onClick={onNewTeam}>
              New team
            </button>
          ) : null}
        </G8Empty>
      </div>
    );

  return (
    <div className="pgrid">
      {teams.map((t) => {
        const ms = (membersBySpace[t.id] ?? [])
          .map((id) => peopleById.get(id))
          .filter((m): m is NonNullable<typeof m> => !!m);
        const ps = links.filter((l) => l.space_id === t.id).length;
        const href = `/p/${propertyId}/spaces/${t.id}`;
        return (
          <div
            key={t.id}
            className="pcard"
            role="link"
            tabIndex={0}
            onClick={() => router.push(href)}
            onKeyDown={(e) => {
              if (e.key === "Enter") router.push(href);
            }}
          >
            <div className="row">
              <TeamIcon team={t} />
              <b style={{ fontWeight: 600, fontSize: 14 }}>{t.name || "Untitled team"}</b>
            </div>
            <div className="desc">
              {t.description ||
                (t.parent_space_id
                  ? `Part of ${parentName.get(t.parent_space_id) ?? "another team"}`
                  : "No description yet.")}
            </div>
            <div className="foot">
              <span className="row" style={{ gap: 4 }}>
                <Gi icon={Users} size={12} />
                {ms.length} {ms.length === 1 ? "member" : "members"}
              </span>
              <span className="row" style={{ gap: 4 }}>
                <Gi icon={Folder} size={12} />
                {ps} {ps === 1 ? "project" : "projects"}
              </span>
              <span className="sp" />
              <AvStack members={ms} max={4} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
