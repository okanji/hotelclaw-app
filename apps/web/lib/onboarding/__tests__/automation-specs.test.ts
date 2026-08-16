import { describe, it, expect } from "vitest";
import {
  buildBlockedTaskAlertSpec,
  buildBookingAutoConfirmSpec,
  buildChatbotEscalationSpec,
  buildMaintenanceAutomationSpec,
} from "../automation-specs";
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

describe("template-library automation specs", () => {
  it("chatbot escalation spec validates (with and without a space)", () => {
    for (const spaceId of ["aaaabbbb-cccc-dddd-eeee-ffff00001111", null]) {
      const spec = buildChatbotEscalationSpec({ spaceId });
      const result = validateSpec(spec);
      expect(result.ok, JSON.stringify(!result.ok ? result.issues : [])).toBe(
        true,
      );
      expect(WorkflowSpec.parse(spec).trigger.event_type).toBe(
        "chatbot.escalated",
      );
    }
  });

  it("booking auto-confirm spec validates and filters pending small parties", () => {
    const spec = buildBookingAutoConfirmSpec();
    const result = validateSpec(spec);
    expect(result.ok, JSON.stringify(!result.ok ? result.issues : [])).toBe(
      true,
    );
    const parsed = WorkflowSpec.parse(spec);
    expect(parsed.trigger.event_type).toBe("booking.created");
    expect(JSON.stringify(parsed.trigger.filter)).toContain("party_size");
  });

  it("blocked-task alert spec validates", () => {
    const spec = buildBlockedTaskAlertSpec({
      channelId: "prop-12345678-general-abc123",
    });
    const result = validateSpec(spec);
    expect(result.ok, JSON.stringify(!result.ok ? result.issues : [])).toBe(
      true,
    );
    expect(WorkflowSpec.parse(spec).trigger.event_type).toBe(
      "task.status_changed",
    );
  });
});
