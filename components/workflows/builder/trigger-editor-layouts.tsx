"use client";

import { InspectorFlowRail, type FlowStep } from "./inspector-flow-layout";
import type { TriggerEditorSlots } from "./trigger-editor-layouts-types";

export type { TriggerEditorSlots } from "./trigger-editor-layouts-types";

/** Vertical timeline — event → labels (optional) → summary → optional filters. */
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
  if (slots.scheduleConfig) {
    steps.push({
      id: "schedule",
      marker: steps.length + 1,
      title: "Schedule",
      children: slots.scheduleConfig,
    });
  }
  steps.push({
    id: "summary",
    marker: steps.length + 1,
    title: "Summary",
    children: (
      <>
        <p className="text-[0.8125rem] leading-relaxed text-foreground/90">{slots.summary}</p>
        <div className="mt-2">{slots.dataContext}</div>
      </>
    ),
  });
  if (slots.conditions) {
    steps.push({
      id: "filters",
      marker: "+",
      title: "Optional filters",
      children: slots.conditions,
    });
  }
  return <InspectorFlowRail steps={steps} />;
}
