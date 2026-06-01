/** Pan the Flow builder canvas so a step or branch lane is centered in view. */
export function panToWorkflowTarget(selector: string) {
  window.dispatchEvent(
    new CustomEvent("workflow:pan-to", { detail: { selector } }),
  );
}

export function panToWorkflowStep(stepId: string) {
  panToWorkflowTarget(`[data-workflow-step="${stepId}"]`);
}

export function panToBranchLane(branchStepId: string, branchKey: string) {
  panToWorkflowTarget(`[data-branch-lane="${branchStepId}:${branchKey}"]`);
}
