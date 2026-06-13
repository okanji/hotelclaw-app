"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { queryOptions } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

/**
 * The triage autonomy dial — the top rung of the trust ladder. Shows each
 * field's accept/dismiss record so the graduation decision is informed, and
 * lets the OWNER flip a field from suggest-only to auto-apply (which still
 * badges every applied value on the task). Managers/staff see the stats
 * read-only.
 */

type TriageField = "space" | "assignee" | "priority";

const FIELD_LABEL: Record<TriageField, string> = {
  space: "Team",
  assignee: "Assignee",
  priority: "Priority",
};

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
  const { data } = useQuery(triageSettingsQueryOptions(propertyId));

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
  }

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 gap-1 px-2 text-[0.75rem]"
          >
            <Sparkles className="size-3.5" />
            AI triage
          </Button>
        }
      />
      <PopoverContent align="end" sideOffset={6} className="w-72 p-3">
        <p className="mb-1 text-[0.6875rem] font-medium tracking-[0.14em] text-muted-foreground uppercase">
          New-task suggestions
        </p>
        <p className="mb-3 text-[0.75rem] leading-relaxed text-muted-foreground">
          Bare tasks get team / assignee / priority suggestions with
          reasoning. Auto-apply skips the confirmation for high-confidence
          calls — applied values stay badged on the task.
        </p>
        <div className="flex flex-col gap-2">
          {(Object.keys(FIELD_LABEL) as TriageField[]).map((field) => {
            const s = data?.stats[field];
            const total = s ? s.accepted + s.dismissed : 0;
            const rate =
              s && total > 0 ? Math.round((s.accepted / total) * 100) : null;
            return (
              <label
                key={field}
                className="flex items-center justify-between gap-3 text-[0.8125rem] text-foreground"
              >
                <span className="flex flex-col">
                  {FIELD_LABEL[field]}
                  <span className="text-[0.6875rem] text-muted-foreground tabular-nums">
                    {rate !== null
                      ? `${rate}% accepted (${total} reviewed${s!.autoApplied > 0 ? `, ${s!.autoApplied} auto` : ""})`
                      : "no reviews yet"}
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={data?.autoApply[field] === true}
                  disabled={!data?.canEdit}
                  onChange={(e) => void toggle(field, e.target.checked)}
                  className="size-3.5 accent-foreground disabled:opacity-40"
                  title={
                    data?.canEdit
                      ? "Auto-apply high-confidence suggestions"
                      : "Only owners can change autonomy"
                  }
                />
              </label>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
