import { describe, it, expect } from "vitest";
import { buildMaintenanceAutomationSpec } from "../automation-specs";
import { validateSpec } from "@/lib/workflows/validate";
import { WorkflowSpec, classifyMode } from "@/lib/workflows/spec";

describe("buildMaintenanceAutomationSpec", () => {
  const spec = buildMaintenanceAutomationSpec({
    formId: "0f00dfa0-1111-2222-3333-444455556666",
    formTitle: "Maintenance request",
    spaceId: "aaaabbbb-cccc-dddd-eeee-ffff00001111",
  });

  it("passes the workflow validator (same gate saveWorkflow uses)", () => {
    const result = validateSpec(spec);
    expect(result.ok, JSON.stringify(!result.ok ? result.issues : [])).toBe(true);
  });

  it("parses as a WorkflowSpec and classifies as instant", () => {
    const parsed = WorkflowSpec.parse(spec);
    expect(parsed.trigger.event_type).toBe("form.submitted");
    expect(classifyMode(parsed)).toBe("instant");
  });

  it("omits space_id when no maintenance team exists", () => {
    const noSpace = buildMaintenanceAutomationSpec({
      formId: "0f00dfa0-1111-2222-3333-444455556666",
      formTitle: "Maintenance request",
      spaceId: null,
    });
    const step = noSpace.steps["create-task"] as { config: Record<string, unknown> };
    expect("space_id" in step.config).toBe(false);
    expect(validateSpec(noSpace).ok).toBe(true);
  });
});
