"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Target } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { initiativesQueryOptions } from "@/lib/query/initiative-queries";
import { LABEL_DOT } from "@/components/labels/label-tokens";
import {
  linkInitiativeProject,
  unlinkInitiativeProject,
} from "@/components/initiatives/actions";
import { useInitiativesRealtime } from "@/components/initiatives/use-initiatives-realtime";

/**
 * The project rail's "Initiatives" row: chips linking to each initiative this
 * project serves, plus a toggle list to link / unlink (many-to-many — a
 * project can serve several initiatives).
 */
export function ProjectInitiativesPicker({
  propertyId,
  projectId,
}: {
  propertyId: string;
  projectId: string;
}) {
  const qc = useQueryClient();
  const { data: initiatives = [] } = useQuery(initiativesQueryOptions(propertyId));
  useInitiativesRealtime(propertyId);
  const linked = useMemo(
    () => initiatives.filter((i) => i.projectIds.includes(projectId)),
    [initiatives, projectId],
  );

  async function toggle(initiativeId: string, isLinked: boolean) {
    const res = isLinked
      ? await unlinkInitiativeProject(initiativeId, projectId)
      : await linkInitiativeProject(initiativeId, projectId);
    if ("error" in res) toast.error(res.error);
    void qc.invalidateQueries({ queryKey: ["initiatives", propertyId] });
    void qc.invalidateQueries({ queryKey: ["initiative", initiativeId] });
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {linked.map((i) => (
        <Link
          key={i.id}
          href={`/p/${propertyId}/initiatives/${i.id}`}
          className="flex min-w-0 items-center gap-1.5 rounded-md bg-muted px-2.5 py-1 text-sm text-foreground transition-colors hover:bg-accent"
        >
          {i.icon ? (
            <span className="text-sm leading-none">{i.icon}</span>
          ) : (
            <span className={cn("size-1.5 rounded-full", LABEL_DOT[i.color])} />
          )}
          <span className="truncate">{i.name}</span>
        </Link>
      ))}
      <Popover>
        <PopoverTrigger
          render={
            <button
              type="button"
              className="rounded-md px-2.5 py-1 text-sm text-faint-foreground transition-colors hover:bg-accent"
            />
          }
        >
          {linked.length === 0 ? "Add to initiative" : "Edit"}
        </PopoverTrigger>
        <PopoverContent align="start" sideOffset={6} className="w-60 p-1.5">
          {initiatives.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-2 py-3 text-center">
              <Target className="size-4 text-faint-foreground" />
              <p className="text-xs text-faint-foreground">No initiatives yet.</p>
              <Link
                href={`/p/${propertyId}/initiatives`}
                className="text-xs text-foreground underline underline-offset-2"
              >
                Create one
              </Link>
            </div>
          ) : (
            <ul className="flex max-h-64 flex-col overflow-y-auto">
              {initiatives.map((i) => {
                const isLinked = i.projectIds.includes(projectId);
                return (
                  <li key={i.id}>
                    <button
                      type="button"
                      onClick={() => void toggle(i.id, isLinked)}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent"
                    >
                      {i.icon ? (
                        <span className="w-2 text-center text-sm leading-none">{i.icon}</span>
                      ) : (
                        <span className={cn("size-2 rounded-full", LABEL_DOT[i.color])} />
                      )}
                      <span className="min-w-0 flex-1 truncate">{i.name}</span>
                      {isLinked ? <Check className="size-3.5 shrink-0" /> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}
