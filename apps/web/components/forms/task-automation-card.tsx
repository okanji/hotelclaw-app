"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowUpRight, Loader2 } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { NativeSelect } from "@/components/ui/native-select";
import { spacesQueryOptions } from "@/lib/query/project-queries";
import { propertyMembersQueryOptions } from "@/lib/query/section-queries";
import {
  FORM_AUTOMATION_PRIORITIES,
  type FormTaskAutomationConfig,
} from "@/lib/forms/task-automation";
import {
  getFormTaskAutomation,
  setFormTaskAutomation,
  type FormTaskAutomationState,
} from "./automation-actions";

const PRIORITY_LABELS: Record<(typeof FORM_AUTOMATION_PRIORITIES)[number], string> = {
  none: "None",
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

const DEFAULT_CONFIG: FormTaskAutomationConfig = {
  spaceId: null,
  assigneeId: null,
  priority: "medium",
};

/**
 * ClickUp-style "After submitting" panel (form Settings tab): a toggle that
 * turns every submission into a task, plus team / assignee / priority — all
 * write-through. Under the hood it manages a real workflow (form.submitted →
 * create task), so the automation also appears in the Workflows section; a
 * workflow that was customized there flips this panel to read-only.
 */
export function TaskAutomationCard({
  propertyId,
  formId,
}: {
  propertyId: string;
  formId: string;
}) {
  const [automation, setAutomation] = useState<FormTaskAutomationState | null>(
    null,
  );
  const [loaded, setLoaded] = useState(false);
  const [saving, startSaving] = useTransition();

  const { data: spaces = [] } = useQuery(spacesQueryOptions(propertyId));
  const { data: members = [] } = useQuery(
    propertyMembersQueryOptions(propertyId),
  );

  useEffect(() => {
    let cancelled = false;
    void getFormTaskAutomation({ propertyId, formId }).then((result) => {
      if (cancelled) return;
      if (!("error" in result)) setAutomation(result.automation);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [propertyId, formId]);

  const enabled = automation?.enabled ?? false;
  const custom = automation !== null && automation.config === null;
  const config = automation?.config ?? DEFAULT_CONFIG;

  function apply(next: { enabled: boolean; config: FormTaskAutomationConfig }) {
    startSaving(async () => {
      const result = await setFormTaskAutomation({
        propertyId,
        formId,
        enabled: next.enabled,
        config: next.config,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setAutomation(result.automation);
    });
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium">After submitting</p>
          <p className="text-xs text-muted-foreground">
            Turn each submission into a task — a request inbox for the team.
          </p>
        </div>
        {saving || !loaded ? (
          <Loader2 className="size-4 animate-spin text-faint-foreground" />
        ) : null}
      </div>

      {custom ? (
        <p className="text-xs text-muted-foreground">
          This form&rsquo;s automation was customized in the Workflows builder,
          so it&rsquo;s managed there now.{" "}
          <Link
            href={`/p/${propertyId}/workflows/${automation.workflowId}`}
            className="inline-flex items-center gap-0.5 font-medium text-foreground underline underline-offset-2"
          >
            Open workflow
            <ArrowUpRight className="size-3" />
          </Link>
        </p>
      ) : (
        <>
          <label className="flex items-center justify-between gap-4">
            <span>
              <span className="block text-sm font-medium">
                Create a task for each submission
              </span>
              <span className="block text-xs text-muted-foreground">
                The first answer becomes the task title; every answer lands in
                the description.
              </span>
            </span>
            <Switch
              checked={enabled}
              disabled={!loaded || saving}
              onCheckedChange={() => apply({ enabled: !enabled, config })}
              aria-label="Create a task for each submission"
            />
          </label>

          {enabled ? (
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="automation-team">Team</Label>
                <NativeSelect
                  id="automation-team"
                  value={config.spaceId ?? ""}
                  disabled={saving}
                  onChange={(e) =>
                    apply({
                      enabled,
                      config: { ...config, spaceId: e.target.value || null },
                    })
                  }
                >
                  <option value="">No team</option>
                  {spaces.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="automation-assignee">Assign to</Label>
                <NativeSelect
                  id="automation-assignee"
                  value={config.assigneeId ?? ""}
                  disabled={saving}
                  onChange={(e) =>
                    apply({
                      enabled,
                      config: { ...config, assigneeId: e.target.value || null },
                    })
                  }
                >
                  <option value="">Unassigned</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name ?? m.email ?? "Member"}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="automation-priority">Priority</Label>
                <NativeSelect
                  id="automation-priority"
                  value={config.priority}
                  disabled={saving}
                  onChange={(e) =>
                    apply({
                      enabled,
                      config: {
                        ...config,
                        priority: e.target
                          .value as FormTaskAutomationConfig["priority"],
                      },
                    })
                  }
                >
                  {FORM_AUTOMATION_PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {PRIORITY_LABELS[p]}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            </div>
          ) : null}

          {automation ? (
            <p className="text-xs text-faint-foreground">
              Powered by the &ldquo;{automation.name}&rdquo; workflow.{" "}
              <Link
                href={`/p/${propertyId}/workflows/${automation.workflowId}`}
                className="inline-flex items-center gap-0.5 underline underline-offset-2"
              >
                Open in Workflows
                <ArrowUpRight className="size-3" />
              </Link>
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
