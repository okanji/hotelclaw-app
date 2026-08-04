"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { TintIcon } from "@/components/ui/tint-card";
import {
  parseAgentConfig,
  type AgentConfig,
  type AgentRow,
} from "@/lib/agents/schema";
import { updateAgent } from "./actions";
import { AgentEditor } from "./agent-editor";
import { AgentChat, type AgentChatSession } from "./agent-chat";
import { ResolvedConfig } from "./resolved-config";

/**
 * Agent workspace: transparent config editor on the left, a live chat with
 * the agent on the right (the chatbots editor + test-console layout). Every
 * save round-trips through the versioned config schema; the next chat
 * session picks the new config up immediately (eve resolves per session).
 */
export function AgentDetail({
  agent,
  brain,
  documents,
  initialSession,
}: {
  agent: AgentRow;
  brain: { configured: boolean; source: string | null };
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
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-border px-6 py-4">
        <Button
          variant="ghost"
          size="icon-sm"
          render={<Link href={`/p/${agent.property_id}/agents`} />}
          aria-label="Back to agents"
        >
          <ArrowLeft className="size-4" />
        </Button>
        <TintIcon tone="lavender" className="text-base">
          {config.avatarEmoji || "🤖"}
        </TintIcon>
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold">
            {name}
          </h1>
          <p className="truncate text-xs text-muted-foreground">
            {config.description || "Internal agent"}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {status === "active" ? (
            <StatusBadge tone="success">Active</StatusBadge>
          ) : (
            <StatusBadge tone="warning">Paused</StatusBadge>
          )}
          <Button variant="outline" size="sm" onClick={toggleStatus} disabled={saving}>
            {status === "active" ? "Pause" : "Activate"}
          </Button>
          <Button size="sm" onClick={save} disabled={saving || !dirty}>
            {saving ? "Saving…" : dirty ? "Save changes" : "Saved"}
          </Button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(360px,480px)]">
        <div className="min-h-0 overflow-y-auto px-6 py-6">
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
          <hr className="my-10 border-border" />
          <ResolvedConfig config={config} status={status} brain={brain} />
        </div>
        <div className="min-h-0 border-t border-border lg:border-t-0 lg:border-l">
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
    </div>
  );
}
