"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LibraryBig, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

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
      <div className="rounded-lg border border-border/60 bg-muted/15 p-10 text-center">
        <LibraryBig
          className="mx-auto mb-3 size-6 text-muted-foreground"
          aria-hidden
        />
        <p className="text-[13px] font-medium text-foreground">No templates yet</p>
        <p className="mx-auto mt-1 max-w-sm text-[12px] text-muted-foreground">
          You can still create a workflow from scratch — describe what you want
          and the AI will design it for you.
        </p>
        <button
          type="button"
          onClick={() => router.push(`/p/${propertyId}/workflows/new`)}
          className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-[12px] font-medium text-background hover:opacity-90"
        >
          <Sparkles className="size-3.5" aria-hidden />
          Build one with AI
        </button>
      </div>
    );
  }

  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {templates.map((t) => (
        <li
          key={t.id}
          className="flex flex-col rounded-lg border border-border/60 bg-muted/10 p-4"
        >
          <div className="mb-2 flex flex-wrap items-center gap-1">
            {t.surfaces.map((s) => (
              <span
                key={s}
                className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
              >
                {s}
              </span>
            ))}
          </div>
          <p className="text-[13px] font-semibold text-foreground">{t.name}</p>
          <p className="mt-1 line-clamp-3 text-[12px] leading-relaxed text-muted-foreground">
            {t.description}
          </p>
          <div className="mt-auto flex items-center justify-end pt-3">
            <button
              type="button"
              onClick={() => fork(t)}
              disabled={!!forking}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-[12px] font-medium text-background disabled:opacity-50",
              )}
            >
              {forking === t.slug ? "Creating…" : "Use template"}
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
