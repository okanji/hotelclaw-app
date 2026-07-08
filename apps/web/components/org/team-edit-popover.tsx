"use client";

import { useMemo, useTransition } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { OrgChart, OrgTeam } from "@/lib/org/queries";
import { updateTeamHierarchy } from "./actions";

/** Per-team hierarchy editor (parent + lead) — shared by the diagram and the
 *  list view. Assigning a lead also titles them "Head of {team}" server-side
 *  when they have no title yet. */
export function TeamEditPopover({
  propertyId,
  team,
  org,
}: {
  propertyId: string;
  team: OrgTeam;
  org: OrgChart;
}) {
  const qc = useQueryClient();
  const [pending, start] = useTransition();

  // A team can't parent itself or any of its descendants (would loop).
  const descendantIds = useMemo(() => {
    const out = new Set<string>([team.id]);
    let added = true;
    while (added) {
      added = false;
      for (const t of org.teams) {
        if (t.parentId && out.has(t.parentId) && !out.has(t.id)) {
          out.add(t.id);
          added = true;
        }
      }
    }
    return out;
  }, [org.teams, team.id]);

  const parentOptions = org.teams.filter((t) => !descendantIds.has(t.id));

  function save(patch: {
    parentId?: string | null;
    leadUserId?: string | null;
  }) {
    start(async () => {
      const res = await updateTeamHierarchy(propertyId, team.id, patch);
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      qc.invalidateQueries({ queryKey: ["org-chart", propertyId] });
    });
  }

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Edit ${team.name}`}
            className="shrink-0 opacity-0 group-hover:opacity-100 data-[popup-open]:opacity-100"
          />
        }
      >
        <Settings2 className="size-4" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-3">
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              Parent team
            </span>
            <NativeSelect
              aria-label="Parent team"
              disabled={pending}
              value={team.parentId ?? ""}
              onChange={(e) =>
                save({ parentId: e.target.value || null })
              }
            >
              <option value="">Top level</option>
              {parentOptions.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </NativeSelect>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              Team lead
            </span>
            <NativeSelect
              aria-label="Team lead"
              disabled={pending}
              value={team.leadUserId ?? ""}
              onChange={(e) =>
                save({ leadUserId: e.target.value || null })
              }
            >
              <option value="">No lead</option>
              {org.people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name ?? "Member"}
                </option>
              ))}
            </NativeSelect>
          </label>
        </div>
      </PopoverContent>
    </Popover>
  );
}
