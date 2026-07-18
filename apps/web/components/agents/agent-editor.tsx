"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Chip } from "@/components/ui/chip";
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
  AGENT_TOOL_CATALOG,
  AGENT_SKILL_LIMIT,
  AGENT_RESOURCE_LIMIT,
  type AgentConfig,
  type AgentSkill,
} from "@/lib/agents/schema";

/**
 * The transparent config form. Everything the runtime uses is on this page
 * in plain sight: the exact system prompt, the model tier, each granted
 * tool with what it allows, each skill's markdown, each attached document.
 */
export function AgentEditor({
  name,
  onNameChange,
  config,
  onConfigChange,
  documents,
}: {
  name: string;
  onNameChange: (name: string) => void;
  config: AgentConfig;
  onConfigChange: (patch: Partial<AgentConfig>) => void;
  documents: { id: string; title: string }[];
}) {
  const [skillDraft, setSkillDraft] = useState<AgentSkill | null>(null);
  const [skillIndex, setSkillIndex] = useState<number | null>(null);

  function toggleTool(id: string) {
    const tools = config.tools.includes(id)
      ? config.tools.filter((t) => t !== id)
      : [...config.tools, id];
    onConfigChange({ tools });
  }

  function toggleResource(id: string) {
    const current = config.resources.documentIds;
    const documentIds = current.includes(id)
      ? current.filter((d) => d !== id)
      : current.length < AGENT_RESOURCE_LIMIT
        ? [...current, id]
        : current;
    onConfigChange({ resources: { documentIds } });
  }

  function saveSkill(skill: AgentSkill) {
    const skills = [...config.skills];
    if (skillIndex === null) skills.push(skill);
    else skills[skillIndex] = skill;
    onConfigChange({ skills });
    setSkillDraft(null);
    setSkillIndex(null);
  }

  function removeSkill(index: number) {
    onConfigChange({ skills: config.skills.filter((_, i) => i !== index) });
  }

  const attachedSet = new Set(config.resources.documentIds);
  const attachedDocs = documents.filter((d) => attachedSet.has(d.id));
  const availableDocs = documents.filter((d) => !attachedSet.has(d.id));

  return (
    <div className="flex max-w-2xl flex-col gap-10">
      <section className="flex flex-col gap-3">
        <Eyebrow>Identity</Eyebrow>
        <div className="flex items-center gap-3">
          <Input
            value={config.avatarEmoji}
            onChange={(e) => onConfigChange({ avatarEmoji: e.target.value })}
            className="w-16 text-center"
            maxLength={8}
            aria-label="Avatar emoji"
          />
          <Input
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            maxLength={120}
            aria-label="Agent name"
          />
        </div>
        <Input
          value={config.description}
          onChange={(e) => onConfigChange({ description: e.target.value })}
          placeholder="One-line description shown on the gallery card"
          maxLength={300}
        />
      </section>

      <section className="flex flex-col gap-3">
        <Eyebrow>Instructions</Eyebrow>
        <p className="text-xs text-pretty text-muted-foreground">
          The agent&apos;s system prompt, verbatim. What you write here is
          exactly what the model receives — nothing hidden.
        </p>
        <Textarea
          value={config.instructions}
          onChange={(e) => onConfigChange({ instructions: e.target.value })}
          placeholder="You are the Duty Manager assistant. Be terse, flag risks, never invent numbers…"
          rows={8}
          maxLength={12_000}
          className="font-mono text-xs leading-relaxed"
        />
      </section>

      <section className="flex flex-col gap-3">
        <Eyebrow>Model</Eyebrow>
        <div className="flex gap-2">
          <Chip
            selected={config.modelTier === "standard"}
            onClick={() => onConfigChange({ modelTier: "standard" })}
          >
            Standard — fast, cheap (Haiku)
          </Chip>
          <Chip
            selected={config.modelTier === "advanced"}
            onClick={() => onConfigChange({ modelTier: "advanced" })}
          >
            Advanced — deeper reasoning (Sonnet)
          </Chip>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <Eyebrow>Tools</Eyebrow>
        <p className="text-xs text-pretty text-muted-foreground">
          A tool the agent isn&apos;t granted doesn&apos;t exist for it.
          Write-capable tools are marked.
        </p>
        <ul role="list" className="flex flex-col divide-y divide-border/60 rounded-lg border border-border">
          {AGENT_TOOL_CATALOG.map((tool) => {
            const granted = config.tools.includes(tool.id);
            return (
              <li key={tool.id} className="flex items-center gap-3 px-4 py-3">
                <input
                  type="checkbox"
                  id={`tool-${tool.id}`}
                  checked={granted}
                  onChange={() => toggleTool(tool.id)}
                  className="size-4 accent-primary"
                />
                <label htmlFor={`tool-${tool.id}`} className="min-w-0 flex-1 cursor-pointer">
                  <span className="flex items-center gap-2 text-sm font-medium">
                    {tool.label}
                    {tool.category === "write" ? (
                      <span className="rounded-full border border-warning/40 px-1.5 py-px text-[10px] text-warning">
                        writes
                      </span>
                    ) : null}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {tool.summary}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <Eyebrow>Skills</Eyebrow>
        <p className="text-xs text-pretty text-muted-foreground">
          Markdown playbooks the agent loads only when relevant — SOPs,
          checklists, house procedures. The description tells the model when
          to reach for one.
        </p>
        {config.skills.length > 0 ? (
          <ul role="list" className="flex flex-col divide-y divide-border/60 rounded-lg border border-border">
            {config.skills.map((skill, index) => (
              <li key={skill.id} className="flex items-center gap-3 px-4 py-3">
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => {
                    setSkillDraft(skill);
                    setSkillIndex(index);
                  }}
                >
                  <span className="block truncate text-sm font-medium">
                    {skill.name}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {skill.description}
                  </span>
                </button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => removeSkill(index)}
                  aria-label={`Remove skill ${skill.name}`}
                >
                  <Trash2 className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
        <div>
          <Button
            variant="outline"
            size="sm"
            disabled={config.skills.length >= AGENT_SKILL_LIMIT}
            onClick={() => {
              setSkillDraft({ id: "", name: "", description: "", markdown: "" });
              setSkillIndex(null);
            }}
          >
            <Plus data-slot="icon" />
            Add skill
          </Button>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <Eyebrow>Resources</Eyebrow>
        <p className="text-xs text-pretty text-muted-foreground">
          Documents the agent may read in full (via its &ldquo;Read attached
          resources&rdquo; tool — grant it above).
        </p>
        {attachedDocs.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {attachedDocs.map((doc) => (
              <Chip key={doc.id} selected onClick={() => toggleResource(doc.id)}>
                {doc.title || "Untitled"} ×
              </Chip>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Nothing attached.</p>
        )}
        {availableDocs.length > 0 ? (
          <details className="text-sm">
            <summary className="cursor-pointer text-xs text-muted-foreground">
              Attach a document ({availableDocs.length} available)
            </summary>
            <div className="mt-2 flex max-h-48 flex-wrap gap-2 overflow-y-auto">
              {availableDocs.map((doc) => (
                <Chip key={doc.id} onClick={() => toggleResource(doc.id)}>
                  {doc.title || "Untitled"}
                </Chip>
              ))}
            </div>
          </details>
        ) : null}
      </section>

      <section className="flex flex-col gap-3">
        <Eyebrow>Starter prompts</Eyebrow>
        <p className="text-xs text-pretty text-muted-foreground">
          Up to four suggested questions shown when a teammate opens the chat.
        </p>
        {[0, 1, 2, 3].map((i) => (
          <Input
            key={i}
            value={config.starterPrompts[i] ?? ""}
            onChange={(e) => {
              const starterPrompts = [...config.starterPrompts];
              starterPrompts[i] = e.target.value;
              onConfigChange({
                starterPrompts: starterPrompts.filter(
                  (p, idx) => p.trim() !== "" || idx < starterPrompts.length - 1,
                ),
              });
            }}
            placeholder={i === 0 ? "What needs my attention today?" : "Optional"}
            maxLength={200}
          />
        ))}
      </section>

      <SkillDialog
        draft={skillDraft}
        editing={skillIndex !== null}
        onClose={() => {
          setSkillDraft(null);
          setSkillIndex(null);
        }}
        onSave={saveSkill}
      />
    </div>
  );
}

function SkillDialog({
  draft,
  editing,
  onClose,
  onSave,
}: {
  draft: AgentSkill | null;
  editing: boolean;
  onClose: () => void;
  onSave: (skill: AgentSkill) => void;
}) {
  const [skill, setSkill] = useState<AgentSkill | null>(null);
  // Sync the incoming draft into local editing state on open.
  const [prevDraft, setPrevDraft] = useState<AgentSkill | null>(null);
  if (draft !== prevDraft) {
    setPrevDraft(draft);
    setSkill(draft);
  }

  const valid =
    skill &&
    skill.name.trim() &&
    skill.description.trim() &&
    skill.markdown.trim();

  function commit() {
    if (!skill || !valid) return;
    const id =
      skill.id ||
      skill.name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "")
        .slice(0, 64);
    onSave({ ...skill, id: id || "skill" });
  }

  return (
    <Dialog open={draft !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit skill" : "Add skill"}</DialogTitle>
          <DialogDescription>
            A skill is a markdown procedure the agent loads when the
            description matches the task at hand.
          </DialogDescription>
        </DialogHeader>
        {skill ? (
          <div className="flex flex-col gap-3">
            <Input
              value={skill.name}
              onChange={(e) => setSkill({ ...skill, name: e.target.value })}
              placeholder="Skill name — e.g. Noise complaint playbook"
              maxLength={80}
            />
            <Input
              value={skill.description}
              onChange={(e) =>
                setSkill({ ...skill, description: e.target.value })
              }
              placeholder="When to use it — e.g. Use when a guest noise complaint needs handling."
              maxLength={300}
            />
            <Textarea
              value={skill.markdown}
              onChange={(e) => setSkill({ ...skill, markdown: e.target.value })}
              placeholder={"1. Apologize and log the complaint.\n2. Call the adjacent room…"}
              rows={10}
              maxLength={20_000}
              className="font-mono text-xs leading-relaxed"
            />
          </div>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" onClick={commit} disabled={!valid}>
            {editing ? "Update skill" : "Add skill"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
