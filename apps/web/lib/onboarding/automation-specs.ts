/**
 * Pure spec builders for onboarding-seeded automations. Plain module (no
 * "server-only") so tests can validate the emitted specs against
 * lib/workflows/validate without a server context.
 */

/** "Chatbot escalates to a human → urgent task" — the guest chatbot is built
 *  for every property, so its escalations should never die in a log. */
export function buildChatbotEscalationSpec(args: { spaceId: string | null }) {
  return {
    workflow_spec_version: 1,
    name: "Chatbot escalations become tasks",
    trigger: {
      event_type: "chatbot.escalated" as const,
    },
    entry_step_id: "create-task",
    steps: {
      "create-task": {
        id: "create-task",
        type: "action.task.create" as const,
        label: "Create follow-up task",
        config: {
          title: "🙋 Guest needs a human — {{trigger.chatbot_name}}",
          description:
            "The guest chatbot handed a conversation to the team. " +
            "Summary: {{trigger.summary}} · Reason: {{trigger.reason}}",
          priority: "high" as const,
          ...(args.spaceId ? { space_id: args.spaceId } : {}),
        },
      },
    },
  };
}

/** "Small pending booking → auto-confirm" — the catalog's own canonical
 *  booking loop (chatbot books pending, automation confirms parties ≤ 4).
 *  Seeded DISABLED: it mutates booking state, so the owner flips it on. */
export function buildBookingAutoConfirmSpec() {
  return {
    workflow_spec_version: 1,
    name: "Auto-confirm small bookings",
    trigger: {
      event_type: "booking.created" as const,
      filter: {
        expr: {
          and: [
            { "==": [{ var: "trigger.status" }, "pending"] },
            { "<=": [{ var: "trigger.party_size" }, 4] },
          ],
        },
      },
    },
    entry_step_id: "confirm",
    steps: {
      confirm: {
        id: "confirm",
        type: "action.booking.set_status" as const,
        label: "Confirm the booking",
        config: {
          booking_id: "{{trigger.booking_id}}",
          status: "confirmed" as const,
        },
      },
    },
  };
}

/** "Task moves to blocked → post to #general" — makes stuck work loud. */
export function buildBlockedTaskAlertSpec(args: { channelId: string }) {
  return {
    workflow_spec_version: 1,
    name: "Blocked tasks get called out",
    trigger: {
      event_type: "task.status_changed" as const,
      filter: { expr: { "==": [{ var: "trigger.to" }, "blocked"] } },
    },
    entry_step_id: "post",
    steps: {
      post: {
        id: "post",
        type: "action.chat.post_message" as const,
        label: "Post to the team channel",
        config: {
          channel_id: args.channelId,
          text: "🚧 Blocked: “{{trigger.new.title}}” — can anyone unblock it?",
        },
      },
    },
  };
}

/** "Maintenance form submitted → create a task" — the canonical starter
 *  automation. Trigger filters on the exact form id this onboarding created;
 *  the task lands on the maintenance team's board when one exists. */
export function buildMaintenanceAutomationSpec(args: {
  formId: string;
  formTitle: string;
  spaceId: string | null;
}) {
  return {
    workflow_spec_version: 1,
    name: "Maintenance requests become tasks",
    trigger: {
      event_type: "form.submitted" as const,
      filter: { expr: { "==": [{ var: "trigger.form_id" }, args.formId] } },
    },
    entry_step_id: "create-task",
    steps: {
      "create-task": {
        id: "create-task",
        type: "action.task.create" as const,
        label: "Create maintenance task",
        config: {
          // fields.0 = the form's first field (Location on the generated
          // maintenance form); formatted is the human-readable value.
          title: "🔧 Maintenance: {{trigger.fields.0.formatted}}",
          description:
            `Submitted via the "${args.formTitle}" form. ` +
            "What needs fixing: {{trigger.fields.1.formatted}} · Urgency: {{trigger.fields.2.formatted}}",
          priority: "medium" as const,
          ...(args.spaceId ? { space_id: args.spaceId } : {}),
        },
      },
    },
  };
}
