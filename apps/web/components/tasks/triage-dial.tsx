"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { queryOptions } from "@tanstack/react-query";
import { Check, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { Eyebrow } from "@/components/ui/eyebrow";

/**
 * The triage autonomy dial — the top rung of the trust ladder. Each field's
 * accept/dismiss record is the hero of its row so the graduation decision is
 * informed: the rate, the sample size, and a plain readiness read ("learning"
 * → "ready" → "auto-applying"). The OWNER flips a field from suggest-only to
 * auto-apply (which still badges every applied value on the task);
 * managers/staff see the same evidence read-only.
 */

type TriageField = "space" | "assignee" | "priority";

const FIELD_LABEL: Record<TriageField, string> = {
  space: "Team",
  assignee: "Assignee",
  priority: "Priority",
};

const FIELDS = Object.keys(FIELD_LABEL) as TriageField[];

/**
 * Enough signal that flipping auto-apply on is a safe call. Presentational
 * guidance for the owner — the bot's own confidence gate is separate.
 */
const READY_MIN_REVIEWS = 5;
const READY_MIN_RATE = 80;

type TriageSettings = {
  autoApply: Partial<Record<TriageField, boolean>>;
  stats: Record<
    string,
    { accepted: number; dismissed: number; autoApplied: number }
  >;
  canEdit: boolean;
};

function triageSettingsQueryOptions(propertyId: string) {
  return queryOptions({
    queryKey: ["triage-settings", propertyId] as const,
    staleTime: 60_000,
    queryFn: async (): Promise<TriageSettings> => {
      const res = await fetch(
        `/api/properties/${propertyId}/triage-settings`,
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error("Failed to load triage settings");
      return res.json();
    },
  });
}

export function TriageDial({ propertyId }: { propertyId: string }) {
  const queryClient = useQueryClient();
  const { data, isPending } = useQuery(triageSettingsQueryOptions(propertyId));

  async function toggle(field: TriageField, enabled: boolean) {
    const res = await fetch(`/api/properties/${propertyId}/triage-settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ field, enabled }),
    });
    if (!res.ok) {
      toast.error("Couldn't update — only owners can change autonomy");
      return;
    }
    await queryClient.invalidateQueries({
      queryKey: ["triage-settings", propertyId],
    });
    toast.success(
      `${FIELD_LABEL[field]} auto-apply ${enabled ? "on" : "off"}`,
    );
  }

  const canEdit = data?.canEdit ?? false;

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 gap-1 px-2 text-xs"
          >
            <Sparkles className="size-3.5 shrink-0" />
            AI triage
          </Button>
        }
      />
      <PopoverContent align="end" sideOffset={6} className="w-80 p-0">
        <div className="border-b border-border/60 p-3">
          <Eyebrow tone="brand">New-task suggestions</Eyebrow>
          <p className="mt-1 text-xs leading-relaxed text-pretty text-muted-foreground">
            Bare tasks get team, assignee, and priority suggestions with
            reasoning. Turn on auto-apply once a field has earned your trust —
            applied values stay badged on the task.
          </p>
        </div>

        {isPending ? (
          <div className="flex flex-col gap-3 p-3">
            {FIELDS.map((field) => (
              <div key={field} className="flex flex-col gap-2">
                <div className="h-3.5 w-16 animate-pulse rounded bg-muted" />
                <div className="h-1 w-full animate-pulse rounded-full bg-muted" />
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col">
            {FIELDS.map((field, i) => (
              <FieldRow
                key={field}
                field={field}
                stats={data?.stats[field]}
                on={data?.autoApply[field] === true}
                canEdit={canEdit}
                first={i === 0}
                onToggle={(next) => void toggle(field, next)}
              />
            ))}
          </div>
        )}

        {!isPending && !canEdit ? (
          <p className="border-t border-border/60 px-3 py-2 text-xs text-muted-foreground">
            Only owners can change autonomy.
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

function FieldRow({
  field,
  stats,
  on,
  canEdit,
  first,
  onToggle,
}: {
  field: TriageField;
  stats?: { accepted: number; dismissed: number; autoApplied: number };
  on: boolean;
  canEdit: boolean;
  first: boolean;
  onToggle: (next: boolean) => void;
}) {
  const reviewed = stats ? stats.accepted + stats.dismissed : 0;
  const rate = reviewed > 0 ? Math.round((stats!.accepted / reviewed) * 100) : null;
  const ready =
    rate !== null && reviewed >= READY_MIN_REVIEWS && rate >= READY_MIN_RATE;
  const applied = stats?.autoApplied ?? 0;

  // Status line under the field name adapts to where this field sits on the
  // ladder — the read the owner actually acts on.
  let status: React.ReactNode;
  if (on) {
    status = (
      <span className="text-success">
        Auto-applying high-confidence calls
        {applied > 0 ? ` · ${applied} applied` : ""}
      </span>
    );
  } else if (rate === null) {
    status = <span className="text-muted-foreground">Learning — no reviews yet</span>;
  } else if (ready) {
    status = (
      <span className="inline-flex items-center gap-1 text-success">
        <Check className="size-3 shrink-0" />
        Enough signal — safe to auto-apply
      </span>
    );
  } else {
    status = (
      <span className="text-muted-foreground">
        Keep reviewing to build trust
      </span>
    );
  }

  return (
    <div
      className={cn(
        "flex items-start justify-between gap-3 px-3 py-3",
        !first && "border-t border-border/60",
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm font-medium text-foreground">
            {FIELD_LABEL[field]}
          </span>
          {rate !== null ? (
            <span className="text-sm tabular-nums text-muted-foreground">
              <span className="font-semibold text-foreground">{rate}%</span>{" "}
              accepted
              <span className="text-muted-foreground/70">
                {" "}
                · {reviewed} reviewed
              </span>
            </span>
          ) : null}
        </div>

        {rate !== null ? (
          <div
            className="h-1 w-full overflow-hidden rounded-full bg-muted"
            role="presentation"
          >
            <div
              className={cn(
                "h-full rounded-full",
                rate >= READY_MIN_RATE
                  ? "bg-success"
                  : rate >= 50
                    ? "bg-warning"
                    : "bg-muted-foreground/40",
              )}
              style={{ width: `${rate}%` }}
            />
          </div>
        ) : null}

        <p className="text-xs leading-snug">{status}</p>
      </div>

      <Switch
        checked={on}
        disabled={!canEdit}
        aria-label={`${FIELD_LABEL[field]} auto-apply`}
        title={
          !canEdit
            ? "Only owners can change autonomy"
            : "Auto-apply high-confidence suggestions"
        }
        onCheckedChange={() => onToggle(!on)}
        className="mt-0.5"
      />
    </div>
  );
}
