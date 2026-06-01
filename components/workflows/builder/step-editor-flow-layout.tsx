"use client";

import type { ReactNode } from "react";
import {
  InspectorAdvancedCollapse,
  InspectorFlowRail,
  type FlowStep,
} from "./inspector-flow-layout";

export type StepEditorFlowMode = "action" | "filter" | "branch";

export type StepEditorFlowSlots = {
  mode: StepEditorFlowMode;
  /** Plain-English canvas line — action/AI steps only. */
  canvasSummary?: ReactNode;
  configure?: ReactNode;
  dataContext?: ReactNode;
  condition?: ReactNode;
  conditionSummary?: ReactNode;
  /** Branch: step 1 — IF conditions. */
  branchCondition?: ReactNode;
  /** Branch: step 2 — Then / Else paths. */
  branchPaths?: ReactNode;
  advanced: ReactNode;
};

/** Vertical timeline for action, AI, filter, and branch step inspectors. */
export function StepEditorFlowLayout({ slots }: { slots: StepEditorFlowSlots }) {
  const steps: FlowStep[] = [];

  if (slots.mode === "filter") {
    steps.push({
      id: "when",
      marker: 1,
      title: "Only continue when",
      children: slots.condition,
    });
    steps.push({
      id: "summary",
      marker: 2,
      title: "Summary",
      children: slots.conditionSummary,
    });
  } else if (slots.mode === "branch") {
    steps.push({
      id: "when",
      marker: 1,
      title: "When should this split?",
      children: slots.branchCondition,
    });
    steps.push({
      id: "paths",
      marker: 2,
      title: "Then and else",
      children: slots.branchPaths,
    });
  } else {
    let n = 0;
    if (slots.canvasSummary) {
      n += 1;
      steps.push({
        id: "canvas",
        marker: n,
        title: "On the canvas",
        children: slots.canvasSummary,
      });
    }
    n += 1;
    steps.push({
      id: "configure",
      marker: n,
      title: "Configure",
      children: slots.configure,
    });
    if (slots.dataContext) {
      n += 1;
      steps.push({
        id: "data",
        marker: n,
        title: "Data you can use",
        children: slots.dataContext,
      });
    }
  }

  return (
    <>
      <InspectorFlowRail steps={steps} />
      <InspectorAdvancedCollapse>{slots.advanced}</InspectorAdvancedCollapse>
    </>
  );
}
