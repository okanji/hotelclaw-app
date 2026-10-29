"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { Eye, LibraryBig, Sparkles, Workflow } from "lucide-react";
import { toast } from "sonner";
import { Gi } from "@/components/gr8r/icon";
import { WfEmpty } from "@/components/workflows/g8-bits";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { WorkflowSpec, classifyMode } from "@/lib/workflows/spec";
import { WorkflowSpecPreview } from "@/components/workflows/spec-preview";
import { surfaceMeta } from "@/components/workflows/builder/surface-badge";
import { FlowSummary } from "@/components/workflows/flow-summary";
import type { Surface } from "@/lib/workflows/catalog/types";

/** gr8r palette colour by the template's primary surface (fallback: rotate). */
const SURFACE_G8: Partial<Record<string, string>> = {
  tasks: "var(--g8-green)",
  docs: "var(--g8-amber)",
  chat: "var(--g8-blue)",
  meetings: "var(--g8-violet)",
  calendar: "var(--g8-violet)",
  forms: "var(--g8-teal)",
  entities: "var(--g8-blue)",
  ai: "var(--g8-accent)",
  control: "var(--g8-amber)",
  external: "var(--g8-orange)",
  system: "var(--g8-gray)",
};
const ROTATE_G8 = [
  "var(--g8-blue)",
  "var(--g8-green)",
  "var(--g8-violet)",
  "var(--g8-amber)",
  "var(--g8-teal)",
  "var(--g8-rose)",
];

// Category tabs, Linear's Loops gallery pattern. Unknown categories fall back
// to a title-cased slug so a new seed row never hides.
const CATEGORY_LABELS: Record<string, string> = {
  tasks: "Tasks",
  guests: "Guests",
  comms: "Communication",
  reports: "Reports",
};
const categoryLabel = (c: string) =>
  CATEGORY_LABELS[c] ?? c.charAt(0).toUpperCase() + c.slice(1);

/** Trigger + step types straight off a template spec, for the flow line. */
function specFlow(spec: Record<string, unknown>) {
  const s = spec as { trigger?: { event_type?: string }; steps?: Record<string, { type?: string }> };
  return {
    trigger: s.trigger?.event_type ?? null,
    steps: Object.values(s.steps ?? {})
      .map((st) => st?.type)
      .filter((t): t is string => typeof t === "string"),
  };
}

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
  const [category, setCategory] = useState<string>("all");
  const categories = useMemo(
    () => [...new Set(templates.map((t) => t.category))].sort(),
    [templates],
  );
  const shown =
    category === "all" ? templates : templates.filter((t) => t.category === category);

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
      <WfEmpty
        icon={LibraryBig}
        title="No templates yet"
        actions={
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => router.push(`/p/${propertyId}/workflows/new`)}
          >
            <Gi icon={Sparkles} size={14} />
            Build one with AI
          </button>
        }
      >
        You can still create a workflow from scratch — describe what you want
        and the AI will design it for you.
      </WfEmpty>
    );
  }

  return (
    <>
      {categories.length > 1 ? (
        <div className="seg" role="group" aria-label="Template categories" style={{ marginBottom: 14 }}>
          <button
            type="button"
            className={category === "all" ? "on" : ""}
            aria-pressed={category === "all"}
            onClick={() => setCategory("all")}
          >
            All
          </button>
          {categories.map((c) => (
            <button
              key={c}
              type="button"
              className={category === c ? "on" : ""}
              aria-pressed={category === c}
              onClick={() => setCategory(c)}
            >
              {categoryLabel(c)}
            </button>
          ))}
        </div>
      ) : null}
      <ul className="pgrid" style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {shown.map((t, i) => {
          const flow = specFlow(t.spec);
          const primary = t.surfaces[0];
          const meta = primary ? surfaceMeta(primary as Surface) : undefined;
          const Glyph = meta?.icon ?? Workflow;
          const c = (primary && SURFACE_G8[primary]) || ROTATE_G8[i % ROTATE_G8.length];
          return (
            <li key={t.id} className="pcard" style={{ cursor: "default" }}>
              <div className="row" style={{ gap: 10 }}>
                <span className="picon" style={{ "--g8-c": c } as CSSProperties}>
                  <Gi icon={Glyph} size={15} />
                </span>
                <span className="trunc" style={{ fontWeight: 600 }}>
                  {t.name}
                </span>
              </div>
              <div className="desc">{t.description}</div>
              <FlowSummary trigger={flow.trigger} stepTypes={flow.steps} />
              <div className="row" style={{ gap: 4, flexWrap: "wrap" }}>
                {t.surfaces.map((s) => (
                  <span key={s} className="badge gray">
                    {surfaceMeta(s as Surface)?.label ?? s}
                  </span>
                ))}
              </div>
              <div className="foot">
                <span className="sp" />
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPreviewing(t)}>
                  <Gi icon={Eye} size={14} />
                  Preview
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={!!forking}
                  onClick={() => fork(t)}
                >
                  {forking === t.slug ? "Creating…" : "Use template"}
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <Dialog
        open={previewing !== null}
        onOpenChange={(o) => (!o ? setPreviewing(null) : undefined)}
      >
        {/* The base DialogContent caps itself at sm:max-w — override BOTH
            width utilities (base + sm: variant) or the panel renders narrower
            than its content. p-0/gap-0 because this dialog manages its own
            header / scroll body / footer bands. */}
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
    </>
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
            <span key={s} className="badge gray">
              {surfaceMeta(s as Surface)?.label ?? s}
            </span>
          ))}
        </div>
        <DialogTitle className="text-base font-semibold">
          {template.name}
        </DialogTitle>
        <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
          {template.description}
        </p>
      </div>

      {/* Flow — the only scrolling region, on a recessed band so the cards
          read as content rather than chrome. */}
      <div className="min-h-0 flex-1 overflow-y-auto border-y border-border bg-muted px-5 py-4">
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
        <button type="button" onClick={onUse} disabled={forking} className="btn btn-primary btn-sm shrink-0">
          {forking ? "Creating…" : "Use template"}
        </button>
      </div>
    </div>
  );
}
