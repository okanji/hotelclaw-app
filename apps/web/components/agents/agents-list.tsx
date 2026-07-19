"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { MoreHorizontal, PenLine, Plus, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SectionHeader } from "@/components/ui/section-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { Eyebrow } from "@/components/ui/eyebrow";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TintIcon } from "@/components/ui/tint-card";
import { EmptyState } from "@/components/ui/empty-state";
import { parseAgentConfig, type AgentRow } from "@/lib/agents/schema";
import { BUILTIN_AGENTS } from "@/lib/agents/builtin";
import { podBotEmoji } from "@/lib/fleet/tool-catalog";
import { NewAgentDialog } from "./new-agent-dialog";
import { deleteAgent } from "./actions";

type PodBotSummary = {
  id: string;
  bot_id: string;
  display_name: string;
  tool_set: string[];
  model_tier: "standard" | "advanced";
};

/** Agents index — the property's own agents, the operated Fleet pod bots
 *  (when the property belongs to a pod), and the read-only Built-in AI
 *  gallery (?view=builtin): the section's transparency contract is that
 *  EVERY AI in the product is visible here. */
export function AgentsList({
  propertyId,
  agents,
  podBots = [],
}: {
  propertyId: string;
  agents: AgentRow[];
  podBots?: PodBotSummary[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const wantsNew = params.get("new") === "1";
  const [newOpen, setNewOpen] = useState(wantsNew);
  const [deleting, setDeleting] = useState<AgentRow | null>(null);
  const base = `/p/${propertyId}/agents`;
  const view = params.get("view") ?? "all";

  useEffect(() => {
    if (wantsNew) router.replace(base);
  }, [wantsNew, router, base]);

  const [prevWantsNew, setPrevWantsNew] = useState(wantsNew);
  if (wantsNew !== prevWantsNew) {
    setPrevWantsNew(wantsNew);
    if (wantsNew) setNewOpen(true);
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col overflow-y-auto px-8 pt-12 pb-16 sm:px-14 sm:pt-16">
      <SectionHeader
        size="page"
        className="flex-wrap gap-y-3"
        title="Agents"
        description="Build internal AI agents for your team — give each one instructions, tools, skills, and resources, then chat with it. Everything an agent can see or do is configured and visible here, including the AI that ships with the app."
        actions={
          <Button onClick={() => setNewOpen(true)}>
            <Plus data-slot="icon" />
            New agent
          </Button>
        }
      />

      <hr className="my-10 border-border" />

      {view !== "builtin" ? (
        <>
          {agents.length === 0 ? (
            <EmptyState
              icon={Sparkles}
              title="No agents yet"
              action={
                <Button onClick={() => setNewOpen(true)}>
                  <Plus data-slot="icon" />
                  New agent
                </Button>
              }
            >
              Create your first agent — a duty-manager brief, a policy
              expert, a bookings analyst — and shape exactly what it can see
              and do.
            </EmptyState>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {agents.map((agent) => (
                <AgentCard
                  key={agent.id}
                  agent={agent}
                  href={`${base}/${agent.id}`}
                  onDelete={() => setDeleting(agent)}
                />
              ))}
            </div>
          )}
          {podBots.length > 0 ? (
            <div className="mt-14">
              <Eyebrow tone="brand">Pod bots</Eyebrow>
              <p className="mt-2 max-w-2xl text-sm text-pretty text-muted-foreground">
                The operated fleet bots serving this property — address them
                with @name in any channel. Configuration and sessions live in
                the Fleet views.
              </p>
              <ul role="list" className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {podBots.map((bot) => (
                  <li key={bot.id}>
                    <Link
                      href={`${base}/fleet/${bot.id}`}
                      className="flex flex-col gap-2 rounded-lg border border-border bg-background p-4 transition-colors hover:bg-muted/40"
                    >
                      <div className="flex items-center gap-3">
                        <TintIcon tone="lavender" className="text-base">
                          {podBotEmoji(bot.bot_id)}
                        </TintIcon>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {bot.display_name}
                          </p>
                          <p className="truncate font-mono text-xs text-muted-foreground">
                            @{bot.bot_id}
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span className="tabular-nums">
                          {bot.tool_set.length} tool{bot.tool_set.length === 1 ? "" : "s"}
                        </span>
                        <span>
                          {bot.model_tier === "advanced"
                            ? "Advanced model"
                            : "Standard model"}
                        </span>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="mt-14">
            <Eyebrow tone="brand">Built-in AI</Eyebrow>
            <p className="mt-2 max-w-2xl text-sm text-pretty text-muted-foreground">
              The assistants that ship with the app. They can&apos;t be edited,
              but what each one reads and does is documented below.
            </p>
            <BuiltinGrid className="mt-6" />
          </div>
        </>
      ) : (
        <BuiltinGrid />
      )}

      <NewAgentDialog
        propertyId={propertyId}
        open={newOpen}
        onOpenChange={setNewOpen}
      />
      <DeleteAgentDialog
        agent={deleting}
        onOpenChange={(o) => {
          if (!o) setDeleting(null);
        }}
        onDeleted={() => {
          setDeleting(null);
          router.refresh();
        }}
      />
    </div>
  );
}

function AgentCard({
  agent,
  href,
  onDelete,
}: {
  agent: AgentRow;
  href: string;
  onDelete: () => void;
}) {
  const router = useRouter();
  const config = parseAgentConfig(agent.config);

  return (
    <div className="group relative flex flex-col gap-3 rounded-lg border border-border bg-background p-4 transition-colors hover:bg-muted/40">
      <Link href={href} className="absolute inset-0" aria-label={agent.name} />
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-3">
          <TintIcon tone="lavender" className="text-base">
            {config.avatarEmoji || <Sparkles />}
          </TintIcon>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{agent.name}</p>
            <p className="truncate text-xs text-muted-foreground">
              {config.description || "No description yet"}
            </p>
          </div>
        </div>
        <div className="relative z-10 shrink-0">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100"
                  aria-label="Agent actions"
                />
              }
            >
              <MoreHorizontal className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => router.push(href)}>
                <PenLine data-slot="icon" />
                Open
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={onDelete}>
                <Trash2 data-slot="icon" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {agent.status === "active" ? (
          <StatusBadge tone="success">Active</StatusBadge>
        ) : (
          <StatusBadge tone="warning">Paused</StatusBadge>
        )}
        <span className="tabular-nums">
          {config.tools.length} tool{config.tools.length === 1 ? "" : "s"}
        </span>
        {config.skills.length > 0 ? (
          <span className="tabular-nums">
            {config.skills.length} skill{config.skills.length === 1 ? "" : "s"}
          </span>
        ) : null}
        <span>{config.modelTier === "advanced" ? "Advanced model" : "Standard model"}</span>
      </div>
    </div>
  );
}

function BuiltinGrid({ className }: { className?: string }) {
  return (
    <div className={className}>
      <ul role="list" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {BUILTIN_AGENTS.map((bot) => (
          <li
            key={bot.id}
            className="flex flex-col gap-2 rounded-lg border border-border/60 bg-muted/30 p-4"
          >
            <div className="flex items-center gap-3">
              <TintIcon tone="lavender" className="text-base">
                {bot.emoji}
              </TintIcon>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{bot.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {bot.where} · {bot.model}
                </p>
              </div>
            </div>
            <p className="text-xs text-pretty text-muted-foreground">
              {bot.promptSummary}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {bot.tools.map((tool) => (
                <span
                  key={tool}
                  className="rounded-full border border-border/60 px-2 py-0.5 text-[11px] text-muted-foreground"
                >
                  {tool}
                </span>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DeleteAgentDialog({
  agent,
  onOpenChange,
  onDeleted,
}: {
  agent: AgentRow | null;
  onOpenChange: (open: boolean) => void;
  onDeleted: () => void;
}) {
  const [pending, startTransition] = useTransition();

  function confirm() {
    if (!agent) return;
    startTransition(async () => {
      const result = await deleteAgent(agent.id);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Agent deleted");
      onDeleted();
    });
  }

  return (
    <Dialog open={agent !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete agent?</DialogTitle>
          <DialogDescription>
            &ldquo;{agent?.name}&rdquo; and its conversation history will be
            permanently deleted.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={confirm}
            disabled={pending}
          >
            {pending ? "Deleting…" : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
