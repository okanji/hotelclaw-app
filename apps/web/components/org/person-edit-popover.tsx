"use client";

import { useState, useTransition } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { OrgChart, OrgPerson } from "@/lib/org/queries";
import { updatePersonHierarchy } from "./actions";

/**
 * Edit a person's title and who they report to — used on the team detail
 * view to shape the in-team hierarchy. The "reports to" options are ordered
 * team-first (the common case: report to your head or a supervisor) then the
 * rest of the property.
 */
export function PersonEditPopover({
  propertyId,
  person,
  org,
  teamMemberIds,
}: {
  propertyId: string;
  person: OrgPerson;
  org: OrgChart;
  teamMemberIds: string[];
}) {
  const qc = useQueryClient();
  const [pending, start] = useTransition();
  const [title, setTitle] = useState(person.title ?? "");

  const inTeam = new Set(teamMemberIds);
  const candidates = org.people
    .filter((p) => p.id !== person.id)
    .sort((a, b) => {
      const at = inTeam.has(a.id) ? 0 : 1;
      const bt = inTeam.has(b.id) ? 0 : 1;
      return at - bt || (a.name ?? "").localeCompare(b.name ?? "");
    });

  function save(patch: { title?: string | null; managerId?: string | null }) {
    start(async () => {
      const res = await updatePersonHierarchy(propertyId, person.id, patch);
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
            aria-label={`Edit ${person.name ?? "member"}`}
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
              Title
            </span>
            <Input
              name={`title-${person.id}`}
              aria-label="Job title"
              placeholder="Job title"
              value={title}
              disabled={pending}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => {
                if ((person.title ?? "") !== title.trim())
                  save({ title: title.trim() || null });
              }}
              className="h-8 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              Reports to
            </span>
            <NativeSelect
              aria-label="Reports to"
              disabled={pending}
              value={person.managerId ?? ""}
              onChange={(e) => save({ managerId: e.target.value || null })}
            >
              <option value="">No manager</option>
              {candidates.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name ?? "Member"}
                  {inTeam.has(p.id) ? "" : " (other team)"}
                </option>
              ))}
            </NativeSelect>
          </label>
        </div>
      </PopoverContent>
    </Popover>
  );
}
