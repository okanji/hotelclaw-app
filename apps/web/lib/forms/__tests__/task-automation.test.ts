import { describe, it, expect } from "vitest";
import {
  buildFormTaskAutomationSpec,
  extractFormTaskAutomationConfig,
  specTargetsForm,
} from "../task-automation";
import { buildMaintenanceAutomationSpec } from "@/lib/onboarding/automation-specs";
import { validateSpec } from "@/lib/workflows/validate";
import { WorkflowSpec, classifyMode } from "@/lib/workflows/spec";

const FORM_ID = "0f00dfa0-1111-2222-3333-444455556666";
const SPACE_ID = "aaaabbbb-cccc-dddd-eeee-ffff00001111";
const USER_ID = "12345678-1234-1234-1234-123456789012";

describe("buildFormTaskAutomationSpec", () => {
  const spec = buildFormTaskAutomationSpec({
    formId: FORM_ID,
    formTitle: "IT request",
    formIcon: "🖥️",
    fieldLabels: ["What is the issue?", "How urgent is it?", "Which device?"],
    config: { spaceId: SPACE_ID, assigneeId: USER_ID, priority: "high" },
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

  it("templates the first answer into the title and every answer into the description", () => {
    const step = spec.steps["create-task"];
    expect(step.config.title).toContain("{{trigger.fields.0.formatted}}");
    expect(step.config.description).toContain(
      "How urgent is it?: {{trigger.fields.1.formatted}}",
    );
    expect(step.config.description).toContain("{{trigger.fields.2.formatted}}");
  });

  it("survives a form with no fields (static title, no field refs)", () => {
    const bare = buildFormTaskAutomationSpec({
      formId: FORM_ID,
      formTitle: "Check-in",
      fieldLabels: [],
      config: { spaceId: null, assigneeId: null, priority: "none" },
    });
    expect(bare.steps["create-task"].config.title).not.toContain("{{");
    expect(validateSpec(bare).ok).toBe(true);
  });

  it("omits space/assignee when unset", () => {
    const bare = buildFormTaskAutomationSpec({
      formId: FORM_ID,
      formTitle: "Check-in",
      fieldLabels: ["Name"],
      config: { spaceId: null, assigneeId: null, priority: "medium" },
    });
    const config = bare.steps["create-task"].config as Record<string, unknown>;
    expect("space_id" in config).toBe(false);
    expect("assignee_id" in config).toBe(false);
  });
});

describe("specTargetsForm / extractFormTaskAutomationConfig", () => {
  it("round-trips the builder's own spec", () => {
    const spec = buildFormTaskAutomationSpec({
      formId: FORM_ID,
      formTitle: "IT request",
      fieldLabels: ["Issue"],
      config: { spaceId: SPACE_ID, assigneeId: null, priority: "urgent" },
    });
    expect(specTargetsForm(spec, FORM_ID)).toBe(true);
    expect(specTargetsForm(spec, USER_ID)).toBe(false);
    expect(extractFormTaskAutomationConfig(spec)).toEqual({
      spaceId: SPACE_ID,
      assigneeId: null,
      priority: "urgent",
    });
  });

  it("recognizes the onboarding starter automation as this form's managed automation", () => {
    const starter = buildMaintenanceAutomationSpec({
      formId: FORM_ID,
      formTitle: "Maintenance request",
      spaceId: SPACE_ID,
    });
    expect(specTargetsForm(starter, FORM_ID)).toBe(true);
    expect(extractFormTaskAutomationConfig(starter)).toEqual({
      spaceId: SPACE_ID,
      assigneeId: null,
      priority: "medium",
    });
  });

  it("flags a multi-step workflow as customized (config null)", () => {
    const spec = buildFormTaskAutomationSpec({
      formId: FORM_ID,
      formTitle: "IT request",
      fieldLabels: ["Issue"],
      config: { spaceId: null, assigneeId: null, priority: "medium" },
    }) as { steps: Record<string, unknown> };
    spec.steps["notify"] = {
      id: "notify",
      type: "action.chat.post",
      config: { channel_id: "prop-x", message: "hi" },
    };
    expect(extractFormTaskAutomationConfig(spec)).toBeNull();
  });

  it("treats a templated space_id as customized-but-parsable (literal ids only)", () => {
    const spec = buildFormTaskAutomationSpec({
      formId: FORM_ID,
      formTitle: "IT request",
      fieldLabels: ["Issue"],
      config: { spaceId: SPACE_ID, assigneeId: null, priority: "medium" },
    });
    spec.steps["create-task"].config.space_id = "{{trigger.new.space_id}}";
    expect(extractFormTaskAutomationConfig(spec)?.spaceId).toBeNull();
  });
});
