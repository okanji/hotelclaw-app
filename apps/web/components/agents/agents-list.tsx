"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { MoreHorizontal, PenLine, Plus, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { Gi } from "@/components/gr8r/icon";
import { G8Empty } from "@/components/gr8r/members-shared";
import { parseAgentConfig, type AgentRow } from "@/lib/agents/schema";
import { BUILTIN_AGENTS } from "@/lib/agents/builtin";
import { podBotEmoji } from "@/lib/fleet/tool-catalog";
import { NewAgentDialog } from "./new-agent-dialog";
import { AgentBuilderDialog } from "./agent-builder-dialog";
import { deleteAgent } from "./actions";
import { PageHeader } from "@/components/shell/page-header";

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
  const [describeOpen, setDescribeOpen] = useState(false);
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

  // gr8r idiom: `.page.wide` › `.ph` (title + Describe / New in `.acts`) ›
  // `.tabs` (All / Built-in AI — the same `?view=` the sidebar body drives) ›
  // `.pgrid` of `.pcard`s, with `h2.sec` group heads for Pod bots + Built-in.
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title="Agents" icon={<Sparkles />} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="page wide" style={{ maxWidth: 1200 }}>
          <div className="ph">
            <div>
              <h1>Agents</h1>
              <p>
                {agents.length} agent{agents.length === 1 ? "" : "s"}
                {podBots.length ? ` · ${podBots.length} pod bot${podBots.length === 1 ? "" : "s"}` : ""}
                {` · ${BUILTIN_AGENTS.length} built-in`}
              </p>
            </div>
            <div className="acts">
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDescribeOpen(true)}>
                <Gi icon={Sparkles} size={14} />
                Describe it
              </button>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => setNewOpen(true)}>
                <Gi icon={Plus} size={14} />
                New agent
              </button>
            </div>
          </div>

          <div className="tabs" style={{ marginBottom: 20 }}>
            <Link href={base} className={view !== "builtin" ? "tab on" : "tab"}>
              All agents <span className="cnt">{agents.length}</span>
            </Link>
            <Link href={`${base}?view=builtin`} className={view === "builtin" ? "tab on" : "tab"}>
              Built-in AI <span className="cnt">{BUILTIN_AGENTS.length}</span>
            </Link>
          </div>

          {view !== "builtin" ? (
            <>
              {agents.length === 0 ? (
                <div className="panel">
                  <G8Empty
                    icon={Sparkles}
                    title="No agents yet"
                    text="Create your first agent — a duty-manager brief, a policy expert, a workload analyst — and shape exactly what it can see and do."
                  >
                    <button type="button" className="btn btn-primary btn-sm" onClick={() => setNewOpen(true)}>
                      <Gi icon={Plus} size={14} />
                      New agent
                    </button>
                  </G8Empty>
                </div>
              ) : (
                <div className="pgrid">
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
                <section style={{ marginTop: 36 }}>
                  <h2 className="sec">Pod bots</h2>
                  <p className="muted" style={{ margin: "4px 0 14px", fontSize: "var(--g8-fs-sm)", maxWidth: 640 }}>
                    The operated fleet bots serving this property — address them
                    with @name in any channel. Configuration and sessions live in
                    the Fleet views.
                  </p>
                  <div className="pgrid">
                    {podBots.map((bot) => (
                      <Link key={bot.id} href={`${base}/fleet/${bot.id}`} className="pcard">
                        <div className="row" style={{ gap: 10 }}>
                          <span className="picon" style={{ "--g8-c": "var(--g8-violet)", fontSize: 15 } as React.CSSProperties}>
                            {podBotEmoji(bot.bot_id)}
                          </span>
                          <div style={{ minWidth: 0 }}>
                            <b className="trunc" style={{ display: "block", fontWeight: 600 }}>
                              {bot.display_name}
                            </b>
                            <span className="mono faint trunc" style={{ display: "block", fontSize: "var(--g8-fs-xs)" }}>
                              @{bot.bot_id}
                            </span>
                          </div>
                        </div>
                        <div className="foot">
                          <span style={{ fontVariantNumeric: "tabular-nums" }}>
                            {bot.tool_set.length} tool{bot.tool_set.length === 1 ? "" : "s"}
                          </span>
                          <span>
                            {bot.model_tier === "advanced" ? "Advanced model" : "Standard model"}
                          </span>
                        </div>
                      </Link>
                    ))}
                  </div>
                </section>
              ) : null}
              <section style={{ marginTop: 36 }}>
                <h2 className="sec">Built-in AI</h2>
                <p className="muted" style={{ margin: "4px 0 14px", fontSize: "var(--g8-fs-sm)", maxWidth: 640 }}>
                  The assistants that ship with the app. They can&apos;t be edited,
                  but what each one reads and does is documented below.
                </p>
                <BuiltinGrid />
              </section>
            </>
          ) : (
            <BuiltinGrid />
          )}

          <AgentBuilderDialog
            propertyId={propertyId}
            open={describeOpen}
            onOpenChange={setDescribeOpen}
          />
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
      </div>
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
    <div className="pcard group">
      <Link href={href} className="absolute inset-0" aria-label={agent.name} />
      <div className="row" style={{ gap: 10, alignItems: "flex-start" }}>
        <span className="picon" style={{ "--g8-c": "var(--g8-violet)", fontSize: 15 } as React.CSSProperties}>
          {config.avatarEmoji || <Gi icon={Sparkles} size={15} />}
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <b className="trunc" style={{ display: "block", fontWeight: 600 }}>{agent.name}</b>
          <p className="desc" style={{ margin: "2px 0 0" }}>
            {config.description || "No description yet"}
          </p>
        </div>
        <div className="more" style={{ zIndex: 1 }}>
          <DropdownMenu>
            <DropdownMenuTrigger className="ibtn ibtn-sm" aria-label="Agent actions">
              <Gi icon={MoreHorizontal} size={15} />
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
      <div className="foot">
        {agent.status === "active" ? (
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
        <span style={{ fontVariantNumeric: "tabular-nums" }}>
          {config.tools.length} tool{config.tools.length === 1 ? "" : "s"}
        </span>
        {config.skills.length > 0 ? (
          <span style={{ fontVariantNumeric: "tabular-nums" }}>
            {config.skills.length} skill{config.skills.length === 1 ? "" : "s"}
          </span>
        ) : null}
        <span>{config.modelTier === "advanced" ? "Advanced model" : "Standard model"}</span>
      </div>
    </div>
  );
}

function BuiltinGrid() {
  return (
    <div className="pgrid">
      {BUILTIN_AGENTS.map((bot) => (
        <div key={bot.id} className="pcard" style={{ cursor: "default" }}>
          <div className="row" style={{ gap: 10 }}>
            <span className="picon" style={{ "--g8-c": "var(--g8-teal)", fontSize: 15 } as React.CSSProperties}>
              {bot.emoji}
            </span>
            <div style={{ minWidth: 0 }}>
              <b className="trunc" style={{ display: "block", fontWeight: 600 }}>{bot.name}</b>
              <span className="faint trunc" style={{ display: "block", fontSize: "var(--g8-fs-xs)" }}>
                {bot.where} · {bot.model}
              </span>
            </div>
          </div>
          <p className="desc" style={{ margin: 0, WebkitLineClamp: "unset" }}>{bot.promptSummary}</p>
          <div className="row" style={{ flexWrap: "wrap", gap: 4 }}>
            {bot.tools.map((tool) => (
              <span key={tool} className="badge">
                {tool}
              </span>
            ))}
          </div>
        </div>
      ))}
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
