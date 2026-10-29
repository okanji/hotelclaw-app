"use client";

import { useQuery } from "@tanstack/react-query";
import { Building2, FolderKanban, Sparkles, User, Users } from "lucide-react";
import { Gi } from "@/components/gr8r/icon";
import {
  projectsQueryOptions,
  spacesQueryOptions,
} from "@/lib/query/project-queries";
import { propertyMembersQueryOptions } from "@/lib/query/section-queries";
import { scopeKey, type InsightScope } from "@/lib/insights/scope";
import { useInsightsTab } from "@/components/insights/insights-tab-context";

/**
 * Insights node body in the sidebar tree — lens SHORTCUTS only. The page owns
 * both controls (the view tab strip and the header's `ScopeSwitcher` lens
 * picker), so it works with this row collapsed; these rows write the same
 * `useInsightsTab` scope, in the switcher's order (Teams, Projects, People).
 * Staff never get either: the whole surface is their personal "My week",
 * labelled here. Markup is gr8r's sidebar vocabulary (`.sitem` rows under
 * `.sgroup` / `.sgroup-h` heads) — it renders inside the Insights tree
 * node's `.sub`.
 */
export function InsightsSection({
  propertyId,
  isManagement,
}: {
  propertyId: string;
  isManagement: boolean;
}) {
  if (!isManagement) {
    return (
      <div className="sitem on" title="My week" aria-current="page">
        <Gi icon={Sparkles} />
        <span className="trunc">My week</span>
      </div>
    );
  }

  return <ScopeNav propertyId={propertyId} />;
}

function ScopeNav({ propertyId }: { propertyId: string }) {
  const { scope, setScope } = useInsightsTab();
  const { data: projects = [] } = useQuery(projectsQueryOptions(propertyId));
  const { data: spaces = [] } = useQuery(spacesQueryOptions(propertyId));
  const { data: members = [] } = useQuery(
    propertyMembersQueryOptions(propertyId),
  );
  const activeKey = scopeKey(scope);

  const row = (
    label: string,
    Icon: typeof Building2,
    next: InsightScope,
  ) => {
    const on = scopeKey(next) === activeKey;
    return (
      <button
        key={scopeKey(next)}
        type="button"
        className={on ? "sitem on" : "sitem"}
        aria-pressed={on}
        title={label}
        onClick={() => setScope(next)}
      >
        <Gi icon={Icon} />
        <span className="trunc">{label}</span>
      </button>
    );
  };

  const group = (title: string, children: React.ReactNode) => (
    <div className="sgroup" style={{ marginTop: 8 }}>
      <div className="sgroup-h">
        <span className="trunc">{title}</span>
      </div>
      {children}
    </div>
  );

  return (
    <>
      {row("Whole property", Building2, { kind: "property" })}
      {spaces.length > 0
        ? group(
            "Teams",
            spaces.map((s) => row(s.name, Users, { kind: "space", id: s.id })),
          )
        : null}
      {projects.length > 0
        ? group(
            "Projects",
            projects.map((p) =>
              row(p.name, FolderKanban, { kind: "project", id: p.id }),
            ),
          )
        : null}
      {members.length > 0
        ? group(
            "People",
            members.map((m) =>
              row(m.name ?? "Unknown", User, { kind: "person", id: m.id }),
            ),
          )
        : null}
    </>
  );
}
