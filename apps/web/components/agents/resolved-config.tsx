"use client";

import { Eyebrow } from "@/components/ui/eyebrow";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  AGENT_TIER_MODELS,
  AGENT_TOOL_CATALOG,
  type AgentConfig,
} from "@/lib/agents/schema";

const BRAIN_TOOL_IDS = new Set(["brain_search", "brain_think", "brain_capture"]);

const TIER_LABELS: Record<AgentConfig["modelTier"], string> = {
  standard: "Standard",
  advanced: "Advanced",
};

/**
 * Read-only mirror of what the eve runtime will actually resolve for this
 * agent's NEXT session (apps/agent resolveSessionAgent) — model, mounted
 * tools, skills, and whether brain tools land on a real binding. Derives
 * live from the editor's config state, so toggling a grant updates it
 * before saving; the honesty rows (paused fallback, unprovisioned brain)
 * are the point.
 */
export function ResolvedConfig({
  config,
  status,
  brain,
}: {
  config: AgentConfig;
  status: string;
  brain: { configured: boolean; source: string | null };
}) {
  const granted = AGENT_TOOL_CATALOG.filter((tool) =>
    config.tools.includes(tool.id),
  );
  const unknownGrants = config.tools.filter(
    (id) => !AGENT_TOOL_CATALOG.some((tool) => tool.id === id),
  );
  const brainGrants = granted.filter((tool) => BRAIN_TOOL_IDS.has(tool.id));
  const paused = status !== "active";

  return (
    <section className="flex flex-col gap-3">
      <div>
        <Eyebrow>Resolved session config</Eyebrow>
        <p className="mt-1 max-w-[52ch] text-xs text-pretty text-muted-foreground">
          What the runtime actually mounts when the next chat session starts.
          Resolution happens per session — save, then start a new chat to
          apply.
        </p>
      </div>

      {paused ? (
        <p className="rounded-md bg-warning/10 px-3 py-2 text-xs text-pretty text-warning">
          Paused — sessions resolve to fallback instructions with no tools
          until the agent is activated.
        </p>
      ) : null}

      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2.5 rounded-lg p-4 text-sm shadow-ring">
        <dt className="text-xs text-muted-foreground">Model</dt>
        <dd className="flex flex-wrap items-center gap-2">
          <span>{TIER_LABELS[config.modelTier]}</span>
          <span className="font-mono text-xs text-muted-foreground">
            {AGENT_TIER_MODELS[config.modelTier]}
          </span>
        </dd>

        <dt className="text-xs text-muted-foreground">Tools</dt>
        <dd>
          {granted.length === 0 ? (
            <span className="text-muted-foreground">
              None — the agent can only converse
            </span>
          ) : (
            <ul role="list" className="flex flex-wrap gap-1.5">
              {granted.map((tool) => (
                <li
                  key={tool.id}
                  className="rounded-md bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground"
                >
                  {tool.id}
                  {tool.category === "write" ? (
                    <span className="ml-1 text-warning">w</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {unknownGrants.length > 0 ? (
            <p className="mt-1.5 text-xs text-pretty text-muted-foreground">
              {unknownGrants.length} granted{" "}
              {unknownGrants.length === 1 ? "id isn't" : "ids aren't"} in the
              catalog and won&apos;t mount:{" "}
              <span className="font-mono">{unknownGrants.join(", ")}</span>
            </p>
          ) : null}
        </dd>

        <dt className="text-xs text-muted-foreground">Brain</dt>
        <dd className="flex flex-wrap items-center gap-2">
          {brainGrants.length === 0 ? (
            <span className="text-muted-foreground">
              No brain tools granted
            </span>
          ) : brain.configured ? (
            <>
              <StatusBadge tone="success">Mounted</StatusBadge>
              <span className="font-mono text-xs text-muted-foreground">
                {brain.source}
              </span>
            </>
          ) : (
            <>
              <StatusBadge tone="neutral">Not provisioned</StatusBadge>
              <span className="text-xs text-muted-foreground">
                brain tools mount but answer fail-soft
              </span>
            </>
          )}
        </dd>

        <dt className="text-xs text-muted-foreground">Skills</dt>
        <dd>
          {config.skills.length === 0 ? (
            <span className="text-muted-foreground">None</span>
          ) : (
            config.skills.map((skill) => skill.name).join(", ")
          )}
        </dd>

        <dt className="text-xs text-muted-foreground">Resources</dt>
        <dd className="tabular-nums">
          {config.resources.documentIds.length === 0 ? (
            <span className="text-muted-foreground">None</span>
          ) : (
            `${config.resources.documentIds.length} document${config.resources.documentIds.length === 1 ? "" : "s"} readable via read_resource`
          )}
        </dd>
      </dl>
    </section>
  );
}
