"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FolderOpen, MessageSquare, Plus } from "lucide-react";
import {
  assistantProjectsKey,
  assistantProjectsQueryOptions,
} from "@/lib/query/assistant-queries";
import { PROJECT_TINTS, asTint, type AssistantProject } from "@/lib/assistant/types";
import { PageHeader } from "@/components/shell/page-header";
import { NewIcon } from "@/components/shell/clickup-icons";
import { Gi } from "@/components/gr8r/icon";
import { tintVar } from "@/components/gr8r/ai-glyphs";
import { G8Empty } from "@/components/gr8r/members-shared";
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
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <PageHeader
        breadcrumbs={[
          {
            label: "Assistant",
            href: `/p/${propertyId}/assistant`,
            icon: <NewIcon />,
          },
          { label: "Projects" },
        ]}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="page">
          <div className="ph">
            <div>
              <h1>Projects</h1>
              <p>
                Standing work whose conversations share instructions, memory, and
                context.
              </p>
            </div>
            <div className="acts">
              <button type="button" className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>
                <Gi icon={Plus} size={14} />
                New project
              </button>
            </div>
          </div>
          {projects.length === 0 ? (
            <G8Empty
              icon={FolderOpen}
              title="No projects yet"
              text="Group related conversations under shared instructions, memory, and context. Everything you tell a project once — how you want things written, what it should remember, which documents matter — applies to every chat inside it."
            >
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setCreating(true)}>
                Create your first project
              </button>
            </G8Empty>
          ) : (
            <div className="pgrid">
              {projects.map((project) => (
                <Link
                  key={project.id}
                  href={`/p/${propertyId}/assistant/projects/${project.id}`}
                  className="pcard"
                >
                  <div className="row" style={{ gap: 10 }}>
                    <span className="picon" style={{ ...tintVar(asTint(project.tint)), fontSize: 15 } as React.CSSProperties}>
                      {project.emoji}
                    </span>
                    <b className="trunc" style={{ fontWeight: 600, fontSize: "var(--g8-fs-md)" }}>
                      {project.name}
                    </b>
                  </div>
                  {project.description ? (
                    <p className="desc" style={{ margin: 0 }}>{project.description}</p>
                  ) : null}
                  <div className="foot">
                    <Gi icon={MessageSquare} size={13} />
                    {chatCounts[project.id]
                      ? `${chatCounts[project.id]} conversation${chatCounts[project.id] === 1 ? "" : "s"}`
                      : "No conversations yet"}
                  </div>
                </Link>
              ))}
            </div>
          )}

          <NewProjectDialog
            propertyId={propertyId}
            open={creating}
            onOpenChange={setCreating}
          />
        </div>
      </div>
    </div>
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
