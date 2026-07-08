import type { OrgChart, OrgPerson, OrgTeam } from "./queries";

/**
 * Render the org chart as compact text for the AI layer. Every bot gets this
 * through `get_org_chart` so it understands who runs what, who reports to
 * whom, and which team owns a piece of work — the difference between "assign
 * this to maintenance" landing on the right person vs. a guess.
 *
 * Deterministic: no model in this path. Names fall back to a short id so the
 * bot can still reference someone whose profile name is blank.
 */
export function renderOrgChart(org: OrgChart): string {
  const nameOf = (id: string | null): string => {
    if (!id) return "—";
    const p = org.people.find((x) => x.id === id);
    return p?.name?.trim() || `user ${id.slice(0, 8)}`;
  };

  const byId = new Map(org.teams.map((t) => [t.id, t] as const));
  const childrenOf = (pid: string | null): OrgTeam[] =>
    org.teams
      .filter((t) => (t.parentId ?? null) === pid)
      .sort((a, b) => a.position - b.position);

  // Guard against a cycle in parent links (bad edit) — cap the recursion.
  const lines: string[] = [];
  function walk(team: OrgTeam, depth: number) {
    if (depth > 8) return;
    const indent = "  ".repeat(depth);
    // Name the management role explicitly ("Isabel Cruz, Head of Housekeeping")
    // so bots route "ask the head of X" style requests to the right person.
    const leadPerson = team.leadUserId
      ? org.people.find((p) => p.id === team.leadUserId)
      : undefined;
    const lead = team.leadUserId
      ? ` — led by ${nameOf(team.leadUserId)}${leadPerson?.title ? ` (${leadPerson.title})` : ""}`
      : "";
    const roster = team.memberIds
      .map((id) => nameOf(id))
      .filter((n) => n !== "—");
    const members = roster.length ? ` (${roster.join(", ")})` : "";
    const desc = team.description?.trim() ? `: ${team.description.trim()}` : "";
    lines.push(`${indent}- ${team.name}${desc}${lead}${members}`);
    for (const child of childrenOf(team.id)) walk(child, depth + 1);
  }

  lines.push("TEAMS (hierarchy):");
  const roots = childrenOf(null).filter((t) => !t.parentId || !byId.has(t.parentId));
  if (roots.length === 0) {
    lines.push("  (no teams defined)");
  } else {
    for (const root of roots) walk(root, 1);
  }

  // Reporting lines — anyone with an explicit manager.
  const reports = org.people.filter((p) => p.managerId);
  lines.push("");
  lines.push("REPORTING LINES:");
  if (reports.length === 0) {
    lines.push("  (none set)");
  } else {
    for (const p of reports) {
      lines.push(`  - ${personLabel(p)} reports to ${nameOf(p.managerId)}`);
    }
  }

  // People index with titles + home team, so the bot can resolve a name.
  lines.push("");
  lines.push("PEOPLE:");
  for (const p of org.people) {
    const title = p.title ? `, ${p.title}` : "";
    const home = p.primaryTeamId
      ? `, on ${byId.get(p.primaryTeamId)?.name ?? "a team"}`
      : "";
    lines.push(`  - ${nameOf(p.id)}${title} (${p.role}${home})`);
  }

  return lines.join("\n");
}

function personLabel(p: OrgPerson): string {
  const name = p.name?.trim() || `user ${p.id.slice(0, 8)}`;
  return p.title ? `${name} (${p.title})` : name;
}
