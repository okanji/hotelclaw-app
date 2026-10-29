"use client";

import { useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { Gi } from "@/components/gr8r/icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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

  // gr8r settings idiom: `.sblock` sections (h2 over a hairline), `.field`
  // / `.input` / `.textarea`, the model tier as a `.seg`, tools + skills as
  // `.srow` rows.
  const lead = { margin: "8px 0 10px", fontSize: "var(--g8-fs-sm)" } as const;
  return (
    <div className="flex flex-col" style={{ maxWidth: 720 }}>
      <section className="sblock" style={{ marginTop: 0 }}>
        <h2>Identity</h2>
        <div className="flex flex-col gap-2" style={{ marginTop: 10 }}>
          <div className="row" style={{ gap: 8 }}>
            <input
              className="input"
              value={config.avatarEmoji}
              onChange={(e) => onConfigChange({ avatarEmoji: e.target.value })}
              style={{ width: 56, textAlign: "center" }}
              maxLength={8}
              aria-label="Avatar emoji"
            />
            <input
              className="input grow"
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              maxLength={120}
              aria-label="Agent name"
            />
          </div>
          <input
            className="input"
            value={config.description}
            onChange={(e) => onConfigChange({ description: e.target.value })}
            placeholder="One-line description shown on the gallery card"
            maxLength={300}
          />
        </div>
      </section>

      <section className="sblock">
        <h2>Instructions</h2>
        <p className="muted" style={lead}>
          The agent&apos;s system prompt, verbatim. What you write here is
          exactly what the model receives — nothing hidden.
        </p>
        <textarea
          className="textarea mono"
          value={config.instructions}
          onChange={(e) => onConfigChange({ instructions: e.target.value })}
          placeholder="You are the Duty Manager assistant. Be terse, flag risks, never invent numbers…"
          rows={8}
          maxLength={12_000}
          style={{ fontSize: "var(--g8-fs-xs)", lineHeight: 1.6 }}
        />
      </section>

      <section className="sblock">
        <h2>Model</h2>
        <div className="seg" style={{ marginTop: 10 }} role="radiogroup" aria-label="Model">
          <button
            type="button"
            role="radio"
            aria-checked={config.modelTier === "standard"}
            className={config.modelTier === "standard" ? "on" : undefined}
            onClick={() => onConfigChange({ modelTier: "standard" })}
          >
            Standard — fast, cheap (Haiku)
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={config.modelTier === "advanced"}
            className={config.modelTier === "advanced" ? "on" : undefined}
            onClick={() => onConfigChange({ modelTier: "advanced" })}
          >
            Advanced — deeper reasoning (Sonnet)
          </button>
        </div>
      </section>

      <section className="sblock">
        <h2>Tools</h2>
        <p className="muted" style={lead}>
          A tool the agent isn&apos;t granted doesn&apos;t exist for it.
          Write-capable tools are marked.
        </p>
        <ul role="list" style={{ margin: 0, padding: 0, listStyle: "none" }}>
          {AGENT_TOOL_CATALOG.map((tool) => {
            const granted = config.tools.includes(tool.id);
            return (
              <li key={tool.id} className="srow" style={{ padding: "10px 0" }}>
                <label htmlFor={`tool-${tool.id}`} className="min-w-0 cursor-pointer">
                  <span className="t row" style={{ gap: 8 }}>
                    {tool.label}
                    {tool.category === "write" ? (
                      <span className="badge amber">writes</span>
                    ) : null}
                  </span>
                  <span className="d" style={{ display: "block" }}>
                    {tool.summary}
                  </span>
                </label>
                <input
                  type="checkbox"
                  id={`tool-${tool.id}`}
                  className="toggle"
                  checked={granted}
                  onChange={() => toggleTool(tool.id)}
                />
              </li>
            );
          })}
        </ul>
      </section>

      <section className="sblock">
        <h2>Skills</h2>
        <p className="muted" style={lead}>
          Markdown playbooks the agent loads only when relevant — SOPs,
          checklists, house procedures. The description tells the model when
          to reach for one.
        </p>
        {config.skills.length > 0 ? (
          <ul role="list" style={{ margin: 0, padding: 0, listStyle: "none" }}>
            {config.skills.map((skill, index) => (
              <li key={skill.id} className="srow" style={{ padding: "10px 0" }}>
                <button
                  type="button"
                  className="min-w-0 text-left"
                  onClick={() => {
                    setSkillDraft(skill);
                    setSkillIndex(index);
                  }}
                >
                  <span className="t trunc" style={{ display: "block" }}>
                    {skill.name}
                  </span>
                  <span className="d trunc" style={{ display: "block" }}>
                    {skill.description}
                  </span>
                </button>
                <button
                  type="button"
                  className="ibtn ibtn-sm"
                  onClick={() => removeSkill(index)}
                  aria-label={`Remove skill ${skill.name}`}
                >
                  <Gi icon={Trash2} size={14} />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <div style={{ marginTop: 10 }}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={config.skills.length >= AGENT_SKILL_LIMIT}
            onClick={() => {
              setSkillDraft({ id: "", name: "", description: "", markdown: "" });
              setSkillIndex(null);
            }}
          >
            <Gi icon={Plus} size={14} />
            Add skill
          </button>
        </div>
      </section>

      <section className="sblock">
        <h2>Resources</h2>
        <p className="muted" style={lead}>
          Documents the agent may read in full (via its &ldquo;Read attached
          resources&rdquo; tool — grant it above).
        </p>
        {attachedDocs.length > 0 ? (
          <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
            {attachedDocs.map((doc) => (
              <span key={doc.id} className="chip">
                {doc.title || "Untitled"}
                <button
                  type="button"
                  className="ibtn ibtn-xs"
                  onClick={() => toggleResource(doc.id)}
                  aria-label={`Detach ${doc.title || "Untitled"}`}
                >
                  <Gi icon={X} size={12} />
                </button>
              </span>
            ))}
          </div>
        ) : (
          <p className="faint" style={{ margin: 0, fontSize: "var(--g8-fs-xs)" }}>Nothing attached.</p>
        )}
        {availableDocs.length > 0 ? (
          <details style={{ marginTop: 10 }}>
            <summary className="link" style={{ cursor: "pointer", fontSize: "var(--g8-fs-xs)" }}>
              Attach a document ({availableDocs.length} available)
            </summary>
            <div className="row" style={{ marginTop: 8, flexWrap: "wrap", gap: 6, maxHeight: 192, overflowY: "auto" }}>
              {availableDocs.map((doc) => (
                <button
                  key={doc.id}
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => toggleResource(doc.id)}
                >
                  <Gi icon={Plus} size={12} />
                  {doc.title || "Untitled"}
                </button>
              ))}
            </div>
          </details>
        ) : null}
      </section>

      <section className="sblock">
        <h2>Starter prompts</h2>
        <p className="muted" style={lead}>
          Up to four suggested questions shown when a teammate opens the chat.
        </p>
        <div className="flex flex-col gap-2">
        {[0, 1, 2, 3].map((i) => (
          <input
            key={i}
            className="input"
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
        </div>
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
