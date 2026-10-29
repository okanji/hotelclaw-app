"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import {
  parseAgentConfig,
  type AgentConfig,
  type AgentRow,
} from "@/lib/agents/schema";
import { updateAgent } from "./actions";
import { AgentEditor } from "./agent-editor";
import { AgentChat, type AgentChatSession } from "./agent-chat";
import { ResolvedConfig } from "./resolved-config";
import { PageShell } from "@/components/ui/page-shell";
import { PageHeader } from "@/components/shell/page-header";

/**
 * Agent workspace: transparent config editor on the left, a live chat with
 * the agent on the right (the chatbots editor + test-console layout). Every
 * save round-trips through the versioned config schema; the next chat
 * session picks the new config up immediately (eve resolves per session).
 */
export function AgentDetail({
  agent,
  documents,
  initialSession,
}: {
  agent: AgentRow;
  documents: { id: string; title: string }[];
  initialSession: AgentChatSession | null;
}) {
  const router = useRouter();
  const [config, setConfig] = useState<AgentConfig>(() =>
    parseAgentConfig(agent.config),
  );
  const [name, setName] = useState(agent.name);
  const [status, setStatus] = useState(agent.status);
  const [dirty, setDirty] = useState(false);
  const [saving, startSaving] = useTransition();

  function patchConfig(patch: Partial<AgentConfig>) {
    setConfig((prev) => ({ ...prev, ...patch }));
    setDirty(true);
  }

  function save() {
    startSaving(async () => {
      const result = await updateAgent({
        agentId: agent.id,
        patch: { name, config },
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setDirty(false);
      toast.success("Agent saved — new chats use the updated config");
      router.refresh();
    });
  }

  function toggleStatus() {
    const next = status === "active" ? "paused" : "active";
    startSaving(async () => {
      const result = await updateAgent({
        agentId: agent.id,
        patch: { status: next },
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setStatus(next);
      toast.success(next === "active" ? "Agent activated" : "Agent paused");
    });
  }

  return (
    // Two-pane workspace (config beside a live chat) — a canvas surface, so
    // the header bar and both panes share the full pane width and one edge.
    <PageShell width="bleed" className="flex h-full min-h-0 flex-col">
      <PageHeader
        className="border-b border-border"
        breadcrumbs={[
          {
            label: "Agents",
            href: `/p/${agent.property_id}/agents`,
            icon: <Sparkles />,
          },
          { label: `${config.avatarEmoji || "🤖"} ${name || "Untitled agent"}` },
        ]}
        actions={
          <div className="row" style={{ gap: 6 }}>
            {status === "active" ? (
              <span className="badge green">
                <span className="dot" />
                Active
              </span>
            ) : (
              <span className="badge amber">
                <span className="dot" />
                Paused
              </span>
            )}
            <button type="button" className="btn btn-secondary btn-sm" onClick={toggleStatus} disabled={saving}>
              {status === "active" ? "Pause" : "Activate"}
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={save} disabled={saving || !dirty}>
              {saving ? "Saving…" : dirty ? "Save changes" : "Saved"}
            </button>
          </div>
        }
      />

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(360px,480px)]">
        <div className="min-h-0 overflow-y-auto" style={{ padding: "24px var(--g8-gutter, 24px) 48px" }}>
          <AgentEditor
            name={name}
            onNameChange={(v) => {
              setName(v);
              setDirty(true);
            }}
            config={config}
            onConfigChange={patchConfig}
            documents={documents}
          />
          {/* Sections separate by WHITESPACE — a full-width rule between two
              stacked panels reads as a seam (notion-spec-v2 §1). */}
          <div style={{ height: 24 }} />
          <ResolvedConfig config={config} status={status} />
        </div>
        <div className="min-h-0 border-t lg:border-t-0 lg:border-l" style={{ borderColor: "var(--g8-border)", background: "var(--g8-surface)" }}>
          <AgentChat
            propertyId={agent.property_id}
            target={{ agentId: agent.id }}
            agentName={name}
            avatarEmoji={config.avatarEmoji}
            starterPrompts={config.starterPrompts}
            paused={status !== "active"}
            initialSession={initialSession}
          />
        </div>
      </div>
    </PageShell>
  );
}
