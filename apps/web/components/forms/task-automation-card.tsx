"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowUpRight, Loader2, Plus, Wand2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  type FormTaskAutomationMappings,
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
  labels: [],
  includeAnswers: true,
};

const NO_MAPPINGS: FormTaskAutomationMappings = {
  assignee: false,
  priority: false,
  dueDate: false,
  labels: false,
};

/**
 * ClickUp-style "After submitting" panel (form Settings tab): a toggle that
 * turns every submission into a task, plus team / assignee / priority /
 * labels — all write-through. Task-property-mapped questions (Add question →
 * Task property) take over their slot: the respondent's answer sets the
 * value and the panel shows a "from a question" chip instead of a select.
 * Under the hood it manages a real workflow (form.submitted → create task),
 * so the automation also appears in the Workflows section; a workflow that
 * was customized there flips this panel to read-only.
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
  const [mappings, setMappings] = useState<FormTaskAutomationMappings>(NO_MAPPINGS);
  const [loaded, setLoaded] = useState(false);
  const [saving, startSaving] = useTransition();
  const [labelDraft, setLabelDraft] = useState("");
  // Optimistic panel state: controls stay ENABLED while a save is in flight
  // (disabling them mid-save silently swallowed rapid edits — a label typed
  // right after picking a team never landed). Saves serialize through
  // `saveChain`; each apply() snapshot is written in order, so the last
  // interaction wins and nothing is dropped.
  const [draft, setDraft] = useState<{
    enabled: boolean;
    config: FormTaskAutomationConfig;
  } | null>(null);
  const saveChain = useRef<Promise<void>>(Promise.resolve());

  const { data: spaces = [] } = useQuery(spacesQueryOptions(propertyId));
  const { data: members = [] } = useQuery(
    propertyMembersQueryOptions(propertyId),
  );

  useEffect(() => {
    let cancelled = false;
    void getFormTaskAutomation({ propertyId, formId }).then((result) => {
      if (cancelled) return;
      if (!("error" in result)) {
        setAutomation(result.automation);
        setMappings(result.mappings);
      }
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [propertyId, formId]);

  const enabled = draft?.enabled ?? automation?.enabled ?? false;
  const custom = automation !== null && automation.config === null;
  const config = draft?.config ?? automation?.config ?? DEFAULT_CONFIG;

  function apply(next: { enabled: boolean; config: FormTaskAutomationConfig }) {
    setDraft(next);
    startSaving(async () => {
      const run = saveChain.current.then(async () => {
        const result = await setFormTaskAutomation({
          propertyId,
          formId,
          enabled: next.enabled,
          config: next.config,
        });
        if ("error" in result) {
          toast.error(result.error);
          // Roll back to the server's truth so the panel doesn't lie.
          setDraft(null);
          return;
        }
        setAutomation(result.automation);
        setMappings(result.mappings);
        // Only clear the optimistic state when no newer edit superseded it.
        setDraft((current) => (current === next ? null : current));
      });
      saveChain.current = run;
      await run;
    });
  }

  function addLabel() {
    const label = labelDraft.trim();
    if (!label) return;
    setLabelDraft("");
    if (config.labels.includes(label)) return;
    apply({ enabled, config: { ...config, labels: [...config.labels, label] } });
  }

  const anyMapping =
    mappings.assignee || mappings.priority || mappings.dueDate || mappings.labels;

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
                The first answer becomes the task title.
              </span>
            </span>
            <Switch
              checked={enabled}
              disabled={!loaded}
              onCheckedChange={() => apply({ enabled: !enabled, config })}
              aria-label="Create a task for each submission"
            />
          </label>

          {enabled ? (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="automation-team">Team</Label>
                  <NativeSelect
                    id="automation-team"
                    value={config.spaceId ?? ""}
                    
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
                  {mappings.assignee ? (
                    <MappedChip label="Assignee question" />
                  ) : (
                    <NativeSelect
                      id="automation-assignee"
                      value={config.assigneeId ?? ""}
                      
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
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="automation-priority">Priority</Label>
                  {mappings.priority ? (
                    <MappedChip label="Priority question" />
                  ) : (
                    <NativeSelect
                      id="automation-priority"
                      value={config.priority}
                      
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
                  )}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="automation-labels">Labels</Label>
                <div className="flex flex-wrap items-center gap-1.5">
                  {config.labels.map((label) => (
                    <span
                      key={label}
                      className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs font-medium"
                    >
                      {label}
                      <button
                        type="button"
                        aria-label={`Remove label ${label}`}
                        
                        onClick={() =>
                          apply({
                            enabled,
                            config: {
                              ...config,
                              labels: config.labels.filter((l) => l !== label),
                            },
                          })
                        }
                        className="rounded-sm text-muted-foreground hover:text-foreground"
                      >
                        <X className="size-3" />
                      </button>
                    </span>
                  ))}
                  {mappings.labels ? <MappedChip label="+ Tags question" /> : null}
                  <div className="flex items-center gap-1">
                    <Input
                      id="automation-labels"
                      value={labelDraft}
                      
                      onChange={(e) => setLabelDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addLabel();
                        }
                      }}
                      placeholder="e.g. maintenance"
                      className="h-7 w-36 text-xs"
                    />
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={addLabel}
                      disabled={!labelDraft.trim()}
                      aria-label="Add label"
                    >
                      <Plus className="size-3.5" />
                    </Button>
                  </div>
                </div>
                <p className="text-xs text-faint-foreground">
                  Applied to every task created from this form.
                </p>
              </div>

              <label className="flex items-center justify-between gap-4">
                <span>
                  <span className="block text-sm font-medium">
                    Add answers to the task description
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    Every question and answer, listed in the description.
                  </span>
                </span>
                <Switch
                  checked={config.includeAnswers}
                  
                  onCheckedChange={() =>
                    apply({
                      enabled,
                      config: { ...config, includeAnswers: !config.includeAnswers },
                    })
                  }
                  aria-label="Add answers to the task description"
                />
              </label>

              {mappings.dueDate ? (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Wand2 className="size-3.5" />
                  The due date comes from this form&rsquo;s due-date question.
                </p>
              ) : null}
              {anyMapping ? (
                <p className="text-xs text-faint-foreground">
                  Task-property questions (added via Add question → Task
                  property) override the defaults above with the
                  respondent&rsquo;s answer.
                </p>
              ) : null}
            </>
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

/** A slot whose value comes from a mapped question, not the panel. */
function MappedChip({ label }: { label: string }) {
  return (
    <span className="inline-flex h-8 items-center gap-1.5 rounded-md bg-muted px-2.5 text-xs font-medium text-muted-foreground">
      <Wand2 className="size-3.5" />
      From the {label.replace("+ ", "")}
    </span>
  );
}
