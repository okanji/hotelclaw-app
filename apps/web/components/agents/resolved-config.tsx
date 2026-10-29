"use client";

import { TriangleAlert } from "lucide-react";
import { Gi } from "@/components/gr8r/icon";
import {
  AGENT_TIER_MODELS,
  AGENT_TOOL_CATALOG,
  type AgentConfig,
} from "@/lib/agents/schema";

const TIER_LABELS: Record<AgentConfig["modelTier"], string> = {
  standard: "Standard",
  advanced: "Advanced",
};

/**
 * Read-only mirror of what the eve runtime will actually resolve for this
 * agent's NEXT session (apps/agent resolveSessionAgent) — model, mounted
 * tools, skills, and the always-on memory slots. Derives live from the
 * editor's config state, so toggling a grant updates it before saving;
 * the honesty rows (paused fallback) are the point.
 */
export function ResolvedConfig({
  config,
  status,
}: {
  config: AgentConfig;
  status: string;
}) {
  const granted = AGENT_TOOL_CATALOG.filter((tool) =>
    config.tools.includes(tool.id),
  );
  const unknownGrants = config.tools.filter(
    (id) => !AGENT_TOOL_CATALOG.some((tool) => tool.id === id),
  );
  const paused = status !== "active";

  return (
    <section className="sblock" style={{ maxWidth: 720 }}>
      <h2>Resolved session config</h2>
      <p className="muted" style={{ margin: "8px 0 12px", fontSize: "var(--g8-fs-sm)", maxWidth: "52ch" }}>
        What the runtime actually mounts when the next chat session starts.
        Resolution happens per session — save, then start a new chat to
        apply.
      </p>

      {paused ? (
        <div className="alert warn" style={{ marginBottom: 12 }}>
          <Gi icon={TriangleAlert} size={15} />
          <div>
            Paused — sessions resolve to fallback instructions with no tools
            until the agent is activated.
          </div>
        </div>
      ) : null}

      <div className="panel">
        <dl className="kv panel-b" style={{ paddingTop: 12, rowGap: 10, alignItems: "start" }}>
          <dt>Model</dt>
          <dd style={{ flexWrap: "wrap", gap: 8 }}>
            <span>{TIER_LABELS[config.modelTier]}</span>
            <span className="mono faint" style={{ fontSize: "var(--g8-fs-xs)" }}>
              {AGENT_TIER_MODELS[config.modelTier]}
            </span>
          </dd>

          <dt>Tools</dt>
          <dd style={{ flexDirection: "column", alignItems: "flex-start" }}>
            {granted.length === 0 ? (
              <span className="muted">None — the agent can only converse</span>
            ) : (
              <ul role="list" className="row" style={{ flexWrap: "wrap", gap: 4, margin: 0, padding: 0, listStyle: "none" }}>
                {granted.map((tool) => (
                  <li key={tool.id} className={tool.category === "write" ? "badge amber mono" : "badge mono"}>
                    {tool.id}
                    {tool.category === "write" ? <span>· w</span> : null}
                  </li>
                ))}
              </ul>
            )}
            {unknownGrants.length > 0 ? (
              <p className="muted" style={{ margin: "6px 0 0", fontSize: "var(--g8-fs-sm)" }}>
                {unknownGrants.length} granted{" "}
                {unknownGrants.length === 1 ? "id isn't" : "ids aren't"} in the
                catalog and won&apos;t mount:{" "}
                <span className="mono">{unknownGrants.join(", ")}</span>
              </p>
            ) : null}
          </dd>

          <dt>Memory</dt>
          <dd style={{ flexWrap: "wrap", gap: 8 }}>
            <span className="badge green">
              <span className="dot" />
              Always on
            </span>
            <span className="faint" style={{ fontSize: "var(--g8-fs-xs)" }}>
              property memory + per-person notes are recalled each turn
              (property__search / remember / forget, person__…)
            </span>
          </dd>

          <dt>Skills</dt>
          <dd>
            {config.skills.length === 0 ? (
              <span className="muted">None</span>
            ) : (
              config.skills.map((skill) => skill.name).join(", ")
            )}
          </dd>

          <dt>Resources</dt>
          <dd style={{ fontVariantNumeric: "tabular-nums" }}>
            {config.resources.documentIds.length === 0 ? (
              <span className="muted">None</span>
            ) : (
              `${config.resources.documentIds.length} document${config.resources.documentIds.length === 1 ? "" : "s"} readable via read_resource`
            )}
          </dd>
        </dl>
      </div>
    </section>
  );
}
