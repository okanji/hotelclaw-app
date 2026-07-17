"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, LibraryBig, Sparkles, Workflow } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import {
  CoverCard,
  coverTintAt,
  type COVER_TINTS,
} from "@/components/ui/cover-card";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { WorkflowSpec, classifyMode } from "@/lib/workflows/spec";
import { WorkflowSpecPreview } from "@/components/workflows/spec-preview";
import { surfaceMeta } from "@/components/workflows/builder/surface-badge";
import type { Surface } from "@/lib/workflows/catalog/types";

/** Cover tint by the template's primary surface (fallback: rotate). */
const SURFACE_TINTS: Partial<Record<string, keyof typeof COVER_TINTS>> = {
  tasks: "sage",
  docs: "amber",
  chat: "blue",
  meetings: "violet",
  calendar: "violet",
  forms: "sage",
  bookings: "violet",
  entities: "blue",
  ai: "cream",
  control: "amber",
  external: "coral",
  system: "cream",
};

type Template = {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  surfaces: string[];
  spec: Record<string, unknown>;
};

export function TemplatesClient({
  propertyId,
  templates,
}: {
  propertyId: string;
  templates: Template[];
}) {
  const router = useRouter();
  const [forking, setForking] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState<Template | null>(null);

  async function fork(template: Template) {
    if (forking) return;
    setForking(template.slug);
    try {
      const res = await fetch(`/api/properties/${propertyId}/workflows`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: template.name,
          description: template.description,
          spec: template.spec,
          enabled: false,
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const { id } = (await res.json()) as { id: string };
      toast.success("Copy created — review and turn it on when ready.");
      router.push(`/p/${propertyId}/workflows/${id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn’t create a copy");
    } finally {
      setForking(null);
    }
  }

  if (templates.length === 0) {
    return (
      <EmptyState
        icon={LibraryBig}
        title="No templates yet"
        action={
          <Button
            size="xs"
            onClick={() => router.push(`/p/${propertyId}/workflows/new`)}
          >
            <Sparkles data-icon="inline-start" aria-hidden />
            Build one with AI
          </Button>
        }
      >
        You can still create a workflow from scratch — describe what you want
        and the AI will design it for you.
      </EmptyState>
    );
  }

  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {templates.map((t, i) => {
        const primary = t.surfaces[0];
        const meta = primary ? surfaceMeta(primary as Surface) : undefined;
        const Glyph = meta?.icon ?? Workflow;
        return (
          <li key={t.id} className="min-w-0">
            <CoverCard
              className="h-full"
              tint={SURFACE_TINTS[primary] ?? coverTintAt(i)}
              glyph={<Glyph />}
              title={t.name}
              description={t.description}
              tags={t.surfaces.map(
                (s) => surfaceMeta(s as Surface)?.label ?? s,
              )}
            >
              <div className="mt-auto flex items-center justify-end gap-2 pt-1">
                <Button variant="outline" size="xs" onClick={() => setPreviewing(t)}>
                  <Eye data-icon="inline-start" aria-hidden />
                  Preview
                </Button>
                <Button size="xs" disabled={!!forking} onClick={() => fork(t)}>
                  {forking === t.slug ? "Creating…" : "Use template"}
                </Button>
              </div>
            </CoverCard>
          </li>
        );
      })}

      <Dialog
        open={previewing !== null}
        onOpenChange={(o) => (!o ? setPreviewing(null) : undefined)}
      >
        {/* The base DialogContent caps itself at sm:max-w-sm — override BOTH
            width utilities (base + sm: variant) or the panel renders narrower
            than its content and the layout shears apart. p-0/gap-0 because
            this dialog manages its own header / scroll body / footer bands. */}
        <DialogContent className="w-full max-w-[calc(100%-2rem)] gap-0 overflow-hidden p-0 sm:max-w-xl">
          {previewing ? (
            <TemplatePreview
              template={previewing}
              forking={!!forking}
              onUse={() => {
                const t = previewing;
                setPreviewing(null);
                void fork(t);
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </ul>
  );
}

function TemplatePreview({
  template,
  forking,
  onUse,
}: {
  template: Template;
  forking: boolean;
  onUse: () => void;
}) {
  const parsed = WorkflowSpec.safeParse(template.spec);
  const stepCount = parsed.success ? Object.keys(parsed.data.steps).length : null;
  const mode = parsed.success ? classifyMode(parsed.data) : null;

  return (
    <div className="flex max-h-[min(42rem,85vh)] flex-col">
      {/* Header — name + context. pr-10 keeps clear of the built-in ✕. */}
      <div className="shrink-0 px-5 pt-5 pb-4 pr-10">
        <div className="mb-2 flex flex-wrap items-center gap-1">
          {template.surfaces.map((s) => (
            <span
              key={s}
              className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium uppercase tracking-wide text-muted-foreground"
            >
              {s}
            </span>
          ))}
        </div>
        <DialogTitle className="text-base font-semibold tracking-tight">
          {template.name}
        </DialogTitle>
        <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
          {template.description}
        </p>
      </div>

      {/* Flow — the only scrolling region, on a recessed band so the cards
          read as content rather than chrome. */}
      <div className="min-h-0 flex-1 overflow-y-auto border-y border-border/60 bg-muted/20 px-5 py-4">
        <WorkflowSpecPreview spec={template.spec} />
      </div>

      {/* Footer — facts left, actions right. */}
      <div className="flex shrink-0 items-center justify-between gap-3 px-5 py-3.5">
        <p className="text-xs text-muted-foreground">
          {stepCount !== null ? (
            <>
              {stepCount} {stepCount === 1 ? "step" : "steps"}
              {mode === "durable" ? " · can wait or delay" : " · runs instantly"}
              {" · "}
            </>
          ) : null}
          Starts turned off — review it first.
        </p>
        <Button size="xs" onClick={onUse} disabled={forking} className="shrink-0">
          {forking ? "Creating…" : "Use template"}
        </Button>
      </div>
    </div>
  );
}
