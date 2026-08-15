"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FolderOpen, Plus } from "lucide-react";
import {
  assistantProjectsKey,
  assistantProjectsQueryOptions,
} from "@/lib/query/assistant-queries";
import { PROJECT_TINTS, asTint, type AssistantProject } from "@/lib/assistant/types";
import { PageShell } from "@/components/ui/page-shell";
import { SectionHeader } from "@/components/ui/section-header";
import { EmptyState } from "@/components/ui/empty-state";
import { TintIcon } from "@/components/ui/tint-card";
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
import { cn } from "@/lib/utils";
import { createProject } from "./actions";

/**
 * Projects gallery. A project is a standing piece of work — a property you
 * manage, a launch, a recurring report — that its conversations inherit
 * instructions, memory, and context from.
 */

const EMOJI_CHOICES = ["📁", "🏨", "🍽️", "🧹", "🛎️", "📊", "🛠️", "🌊", "✨", "📌"];

export function ProjectsList({
  propertyId,
  initialProjects,
  chatCounts,
  openNew = false,
}: {
  propertyId: string;
  initialProjects: AssistantProject[];
  chatCounts: Record<string, number>;
  /** Deep link `?new=1` from the sidebar's "New project" entry. */
  openNew?: boolean;
}) {
  const { data: projects = initialProjects } = useQuery({
    ...assistantProjectsQueryOptions(propertyId),
    initialData: initialProjects,
  });
  const [creating, setCreating] = useState(openNew);

  return (
    <PageShell className="px-10 py-8">
      <SectionHeader
        size="page"
        title="Projects"
        description="Group related conversations under shared instructions, memory, and context."
        actions={
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus />
            New project
          </Button>
        }
      />

      {projects.length === 0 ? (
        <EmptyState
          className="mt-6"
          icon={FolderOpen}
          title="No projects yet"
          action={
            <Button size="sm" variant="secondary" onClick={() => setCreating(true)}>
              Create your first project
            </Button>
          }
        >
          A project keeps a body of work together: everything you tell it once
          — how you want things written, what it should remember, which
          documents matter — applies to every chat inside it.
        </EmptyState>
      ) : (
        <ul role="list" className="mt-6 grid gap-3 sm:grid-cols-2">
          {projects.map((project) => (
            <li key={project.id}>
              <Link
                href={`/p/${propertyId}/assistant/projects/${project.id}`}
                className="flex h-full flex-col gap-2 rounded-card bg-card p-4 shadow-card transition-colors hover:bg-accent"
              >
                <div className="flex items-center gap-2.5">
                  <TintIcon tone={asTint(project.tint)}>{project.emoji}</TintIcon>
                  <span className="min-w-0 flex-1 truncate text-base font-medium">
                    {project.name}
                  </span>
                </div>
                {project.description ? (
                  <p className="line-clamp-2 text-sm text-pretty text-muted-foreground">
                    {project.description}
                  </p>
                ) : null}
                <p className="mt-auto pt-1 text-xs text-faint-foreground">
                  {chatCounts[project.id]
                    ? `${chatCounts[project.id]} conversation${chatCounts[project.id] === 1 ? "" : "s"}`
                    : "No conversations yet"}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <NewProjectDialog
        propertyId={propertyId}
        open={creating}
        onOpenChange={setCreating}
      />
    </PageShell>
  );
}

function NewProjectDialog({
  propertyId,
  open,
  onOpenChange,
}: {
  propertyId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [emoji, setEmoji] = useState(EMOJI_CHOICES[0]);
  const [tint, setTint] = useState<string>(PROJECT_TINTS[0]);
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      const result = await createProject({
        propertyId,
        name,
        description,
        emoji,
        tint,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      await qc.invalidateQueries({ queryKey: assistantProjectsKey(propertyId) });
      onOpenChange(false);
      setName("");
      setDescription("");
      router.push(`/p/${propertyId}/assistant/projects/${result.projectId}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>
            Name it after the work, not the tool — &ldquo;Poolside
            refurbishment&rdquo;, &ldquo;Winter menu launch&rdquo;.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="project-name" className="text-sm font-medium">
              Name
            </label>
            <Input
              id="project-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Poolside refurbishment"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") void submit();
              }}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="project-description" className="text-sm font-medium">
              Description <span className="text-faint-foreground">(optional)</span>
            </label>
            <Textarea
              id="project-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this project is for."
              rows={2}
            />
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium">Icon</legend>
            <div className="flex flex-wrap gap-1">
              {EMOJI_CHOICES.map((choice) => (
                <button
                  key={choice}
                  type="button"
                  onClick={() => setEmoji(choice)}
                  aria-pressed={emoji === choice}
                  className={cn(
                    "flex size-8 items-center justify-center rounded-md text-base transition-colors hover:bg-accent",
                    emoji === choice && "bg-accent-pressed",
                  )}
                >
                  {choice}
                </button>
              ))}
            </div>
            <div className="flex gap-1.5">
              {PROJECT_TINTS.map((choice) => (
                <button
                  key={choice}
                  type="button"
                  onClick={() => setTint(choice)}
                  aria-label={choice}
                  aria-pressed={tint === choice}
                  className={cn(
                    "rounded-md p-0.5 transition-shadow",
                    tint === choice && "shadow-focus",
                  )}
                >
                  <TintIcon tone={choice}>{emoji}</TintIcon>
                </button>
              ))}
            </div>
          </fieldset>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={!name.trim() || saving}>
            Create project
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
