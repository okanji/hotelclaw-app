"use client";

import { InspectorFlowRail, type FlowStep } from "./inspector-flow-layout";
import type { TriggerEditorSlots } from "./trigger-editor-layouts-types";

export type { TriggerEditorSlots } from "./trigger-editor-layouts-types";

/**
 * Vertical timeline — event → labels (optional) → optional filters → summary.
 * Every input that shapes the trigger (the event, label filter, schedule, and
 * the optional field filters) is grouped ahead of the Summary, which is a
 * recap and therefore always comes last.
 */
export function TriggerEditorFlowLayout({ slots }: { slots: TriggerEditorSlots }) {
  const steps: FlowStep[] = [
    { id: "event", marker: 1, title: "Start with this event", children: slots.eventSelect },
  ];
  if (slots.labelFilter) {
    steps.push({
      id: "labels",
      marker: steps.length + 1,
      title: "Only these labels",
      children: slots.labelFilter,
    });
  }
  if (slots.fieldFilter) {
    steps.push({
      id: "field",
      marker: steps.length + 1,
      title: "Only this field",
      children: slots.fieldFilter,
    });
  }
  if (slots.scheduleConfig) {
    steps.push({
      id: "schedule",
      marker: steps.length + 1,
      title: "Schedule",
      children: slots.scheduleConfig,
    });
  }
  if (slots.webhookUrl) {
    steps.push({
      id: "webhook",
      marker: steps.length + 1,
      title: "Webhook URL",
      children: slots.webhookUrl,
    });
  }
  if (slots.conditions) {
    steps.push({
      id: "filters",
      marker: "+",
      title: "Optional filters",
      children: slots.conditions,
    });
  }
  steps.push({
    // Number sequentially after the numbered config steps — the "+" optional
    // filters step doesn't consume a number, so don't count it here.
    id: "summary",
    marker: steps.filter((s) => typeof s.marker === "number").length + 1,
    title: "Summary",
    children: (
      <>
        <p className="text-sm leading-relaxed text-foreground/90">{slots.summary}</p>
        <div className="mt-2">{slots.dataContext}</div>
      </>
    ),
  });
  return <InspectorFlowRail steps={steps} />;
}
