"use client";

import { customFieldsQueryOptions } from "@/lib/query/custom-field-queries";
import { FIELD_TYPE_LABEL } from "@/lib/tasks/custom-field-options";
import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowUpRight, Loader2, Plus, Wand2, X, Zap } from "lucide-react";
import { Gi } from "@/components/gr8r/icon";
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
  fields: [],
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
  const { data: customFields = [] } = useQuery(customFieldsQueryOptions(propertyId));
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
    // gr8r `.panel`: the "create a task" automation reads as one card in the
    // settings column, header first.
    <section className="panel @container space-y-4" style={{ padding: 14 }}>
      <div className="row" style={{ gap: 10, alignItems: "flex-start" }}>
        <span className="ftype" style={{ "--g8-c": "var(--g8-violet)" } as React.CSSProperties}>
          <Gi icon={Zap} size={14} />
        </span>
        <div className="grow" style={{ minWidth: 0 }}>
          <h3 className="g8-fs-h">After submitting</h3>
          <p className="hint" style={{ margin: "2px 0 0" }}>
            Turn each submission into a task — a request inbox for the team.
          </p>
        </div>
        {saving || !loaded ? (
          <Gi icon={Loader2} size={15} className="animate-spin" />
        ) : null}
      </div>

      {custom ? (
        <p className="alert info" style={{ margin: 0 }}>
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
              <span className="block" style={{ fontWeight: 500 }}>
                Create a task for each submission
              </span>
              <span className="hint block">
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
              <div className="grid gap-3 @lg:grid-cols-3">
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
                      className="badge"
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
                        className="ibtn ibtn-xs"
                        style={{ width: 14, height: 14 }}
                      >
                        <Gi icon={X} size={10} />
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

              {mappings.fields.length > 0 ? (
                <div className="flex flex-col gap-1.5">
                  <p className="text-xs text-muted-foreground">Custom fields filled from answers</p>
                  <div className="flex flex-wrap gap-1.5">
                    {mappings.fields.map((id) => {
                      const cf = customFields.find((f) => f.id === id);
                      const scoped = cf && (cf.space_id || cf.list_id);
                      return (
                        <span key={id} className="inline-flex flex-col gap-0.5">
                          <MappedChip
                            label={
                              cf
                                ? `+ question → ${cf.name} (${FIELD_TYPE_LABEL[cf.type]})`
                                : "+ question → an archived field"
                            }
                          />
                          {scoped && cf.space_id && cf.space_id !== config.spaceId ? (
                            <span className="text-xs text-warning">
                              {cf.name} only applies to another team&rsquo;s tasks
                            </span>
                          ) : null}
                        </span>
                      );
                    })}
                  </div>
                </div>
              ) : null}
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
    // min-h (not a fixed h-8): "From the Assignee question" wraps to two
    // lines inside the narrow grid column, and a fixed height clipped it.
    <span className="badge accent" style={{ minHeight: 28, height: "auto", padding: "4px 8px", lineHeight: 1.2 }}>
      <Gi icon={Wand2} size={12} />
      <span>From the {label.replace("+ ", "")}</span>
    </span>
  );
}
