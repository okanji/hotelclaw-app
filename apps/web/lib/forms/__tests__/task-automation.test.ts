import { describe, it, expect } from "vitest";
import {
  buildFormTaskAutomationSpec,
  deriveTaskMappings,
  extractFormTaskAutomationConfig,
  specTargetsForm,
  type FormTaskAutomationConfig,
} from "../task-automation";
import { buildMaintenanceAutomationSpec } from "@/lib/onboarding/automation-specs";
import { validateSpec } from "@/lib/workflows/validate";
import { WorkflowSpec, classifyMode } from "@/lib/workflows/spec";

const FORM_ID = "0f00dfa0-1111-2222-3333-444455556666";
const SPACE_ID = "aaaabbbb-cccc-dddd-eeee-ffff00001111";
const USER_ID = "12345678-1234-1234-1234-123456789012";

function config(partial?: Partial<FormTaskAutomationConfig>): FormTaskAutomationConfig {
  return {
    spaceId: null,
    assigneeId: null,
    priority: "medium",
    labels: [],
    includeAnswers: true,
    ...partial,
  };
}

describe("buildFormTaskAutomationSpec", () => {
  const spec = buildFormTaskAutomationSpec({
    formId: FORM_ID,
    formTitle: "IT request",
    formIcon: "🖥️",
    fieldLabels: ["What is the issue?", "How urgent is it?", "Which device?"],
    config: config({ spaceId: SPACE_ID, assigneeId: USER_ID, priority: "high" }),
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

  it("omits answer lines when includeAnswers is off", () => {
    const bare = buildFormTaskAutomationSpec({
      formId: FORM_ID,
      formTitle: "IT request",
      fieldLabels: ["Issue", "Device"],
      config: config({ includeAnswers: false }),
    });
    expect(bare.steps["create-task"].config.description).not.toContain(
      "{{trigger.fields.",
    );
    expect(validateSpec(bare).ok).toBe(true);
  });

  it("survives a form with no fields (static title, no field refs)", () => {
    const bare = buildFormTaskAutomationSpec({
      formId: FORM_ID,
      formTitle: "Check-in",
      fieldLabels: [],
      config: config({ priority: "none" }),
    });
    expect(bare.steps["create-task"].config.title).not.toContain("{{");
    expect(validateSpec(bare).ok).toBe(true);
  });

  it("omits space/assignee/labels/due date when unset", () => {
    const bare = buildFormTaskAutomationSpec({
      formId: FORM_ID,
      formTitle: "Check-in",
      fieldLabels: ["Name"],
      config: config(),
    });
    const stepConfig = bare.steps["create-task"].config as Record<string, unknown>;
    expect("space_id" in stepConfig).toBe(false);
    expect("assignee_id" in stepConfig).toBe(false);
    expect("labels" in stepConfig).toBe(false);
    expect("due_at" in stepConfig).toBe(false);
  });

  it("emits static labels into the create-task config", () => {
    const withLabels = buildFormTaskAutomationSpec({
      formId: FORM_ID,
      formTitle: "Maintenance",
      fieldLabels: ["Issue"],
      config: config({ labels: ["maintenance", "guest-request"] }),
    });
    expect(withLabels.steps["create-task"].config.labels).toEqual([
      "maintenance",
      "guest-request",
    ]);
    expect(validateSpec(withLabels).ok).toBe(true);
  });

  it("wires mapped task properties as trigger.task_properties refs", () => {
    const mapped = buildFormTaskAutomationSpec({
      formId: FORM_ID,
      formTitle: "Maintenance",
      fieldLabels: ["Issue", "Assignee", "Priority", "Due", "Tags"],
      config: config({
        spaceId: SPACE_ID,
        assigneeId: USER_ID,
        priority: "low",
        labels: ["maintenance"],
      }),
      mappings: { assignee: true, priority: true, dueDate: true, labels: true },
    });
    const stepConfig = mapped.steps["create-task"].config;
    // Mapped slots win over the panel's static defaults.
    expect(stepConfig.assignee_id).toBe("{{trigger.task_properties.assignee_id}}");
    expect(stepConfig.priority).toBe("{{trigger.task_properties.priority}}");
    expect(stepConfig.due_at).toBe("{{trigger.task_properties.due_at}}");
    // Static labels stay alongside the mapped-labels ref (runner flattens).
    expect(stepConfig.labels).toEqual([
      "maintenance",
      "{{trigger.task_properties.labels}}",
    ]);
    // Space has no mapping — the static pick stays.
    expect(stepConfig.space_id).toBe(SPACE_ID);
    expect(validateSpec(mapped).ok, "mapped spec must pass save validation").toBe(true);
  });
});

describe("deriveTaskMappings", () => {
  it("derives which properties the form's questions map", () => {
    expect(
      deriveTaskMappings([
        { taskProperty: undefined },
        { taskProperty: "assignee" },
        { taskProperty: "labels" },
      ]),
    ).toEqual({ assignee: true, priority: false, dueDate: false, labels: true });
  });
});

describe("specTargetsForm / extractFormTaskAutomationConfig", () => {
  it("round-trips the builder's own spec", () => {
    const spec = buildFormTaskAutomationSpec({
      formId: FORM_ID,
      formTitle: "IT request",
      fieldLabels: ["Issue"],
      config: config({
        spaceId: SPACE_ID,
        priority: "urgent",
        labels: ["it", "request"],
      }),
    });
    expect(specTargetsForm(spec, FORM_ID)).toBe(true);
    expect(specTargetsForm(spec, USER_ID)).toBe(false);
    expect(extractFormTaskAutomationConfig(spec)).toEqual({
      spaceId: SPACE_ID,
      assigneeId: null,
      priority: "urgent",
      labels: ["it", "request"],
      includeAnswers: true,
    });
  });

  it("round-trips a mapped spec: template refs extract as static defaults", () => {
    const spec = buildFormTaskAutomationSpec({
      formId: FORM_ID,
      formTitle: "Maintenance",
      fieldLabels: ["Issue"],
      config: config({ labels: ["maintenance"] }),
      mappings: { assignee: true, priority: true, dueDate: false, labels: true },
    });
    expect(extractFormTaskAutomationConfig(spec)).toEqual({
      spaceId: null,
      assigneeId: null, // template ref → not a literal id
      priority: "none", // template ref → falls back
      labels: ["maintenance"], // the mapped-labels ref is filtered out
      includeAnswers: true,
    });
  });

  it("recognizes the onboarding starter automation as this form's managed automation", () => {
    const starter = buildMaintenanceAutomationSpec({
      formId: FORM_ID,
      formTitle: "Maintenance request",
      spaceId: SPACE_ID,
    });
    expect(specTargetsForm(starter, FORM_ID)).toBe(true);
    const extracted = extractFormTaskAutomationConfig(starter);
    expect(extracted).toMatchObject({
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
      config: config(),
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
      config: config({ spaceId: SPACE_ID }),
    });
    spec.steps["create-task"].config.space_id = "{{trigger.new.space_id}}";
    expect(extractFormTaskAutomationConfig(spec)?.spaceId).toBeNull();
  });
});
