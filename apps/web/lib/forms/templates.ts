import type { FormField, FormSchema } from "./schema";

/**
 * Starter forms — the studio builder's "Add starter forms" idea, re-cut for
 * hotel operations. Each is a complete `FormSchema` (stable, readable field
 * ids so workflow refs stay legible) that `createForm` saves as a DRAFT; the
 * team edits the wording in the builder before publishing.
 */
export type StarterForm = {
  key: string;
  title: string;
  description: string;
  icon: string;
  schema: FormSchema;
};

const opts = (...labels: string[]) =>
  labels.map((label, i) => ({ id: `o${i + 1}`, label }));

const f = (field: FormField): FormField => field;

export const STARTER_FORMS: StarterForm[] = [
  {
    key: "activity-waiver",
    title: "Activity waiver",
    description:
      "Guests read and sign before spa treatments, water sports, gym use or excursions.",
    icon: "✍️",
    schema: {
      version: 1,
      fields: [
        f({ id: "about", type: "section", label: "About you" }),
        f({ id: "guest_name", type: "short_text", label: "Full name", required: true }),
        f({ id: "room", type: "short_text", label: "Room number" }),
        f({ id: "phone", type: "phone", label: "Phone", required: true }),
        f({ id: "activity_date", type: "date", label: "Activity date", required: true }),
        f({ id: "health", type: "section", label: "Health" }),
        f({
          id: "conditions",
          type: "yes_no",
          label: "Any medical condition, injury or pregnancy we should know about?",
          required: true,
        }),
        f({
          id: "conditions_detail",
          type: "long_text",
          label: "Tell us more",
          condition: { fieldId: "conditions", op: "equals", value: "yes" },
        }),
        f({
          id: "notice",
          type: "info",
          label:
            "Activities carry some risk. Our team will brief you before you start; tell them at any time if you want to stop.",
        }),
        f({
          id: "consent_risk",
          type: "consent",
          label: "Assumption of risk",
          description:
            "I understand the activity involves physical exertion and some risk, I have given accurate health information, and I will follow the instructions of the staff.",
          required: true,
        }),
        f({
          id: "consent_photo",
          type: "consent",
          label: "Photos",
          description:
            "The property may use photos taken during the activity on its website and social media.",
        }),
        f({ id: "signature", type: "signature", label: "Signature", required: true }),
      ],
      settings: { submitLabel: "Sign and submit" },
    },
  },
  {
    key: "maintenance-request",
    title: "Maintenance request",
    description: "Spotted something broken? Log it so the maintenance team can pick it up.",
    icon: "🔧",
    schema: {
      version: 1,
      fields: [
        f({ id: "location", type: "short_text", label: "Location", required: true }),
        f({ id: "issue", type: "long_text", label: "What needs fixing?", required: true }),
        f({
          id: "urgency",
          type: "select",
          label: "Urgency",
          required: true,
          options: opts("Low — whenever", "Normal — this week", "Urgent — today"),
        }),
        f({ id: "safe", type: "yes_no", label: "Is the area safe to use in the meantime?" }),
        f({ id: "photos", type: "file", label: "Photos" }),
      ],
    },
  },
  {
    key: "incident-report",
    title: "Incident report",
    description: "Log accidents, security issues or anything that needs a record and follow-up.",
    icon: "🚨",
    schema: {
      version: 1,
      fields: [
        f({ id: "where", type: "short_text", label: "Where did it happen?", required: true }),
        f({ id: "when", type: "date", label: "When did it happen?", required: true }),
        f({ id: "what", type: "long_text", label: "What happened?", required: true }),
        f({
          id: "severity",
          type: "select",
          label: "Severity",
          required: true,
          options: opts("Minor", "Moderate", "Serious"),
        }),
        f({ id: "involved", type: "short_text", label: "Who was involved?" }),
        f({ id: "authorities", type: "yes_no", label: "Were the authorities contacted?" }),
        f({ id: "evidence", type: "file", label: "Photos or documents" }),
        f({
          id: "accurate",
          type: "consent",
          label: "Statement",
          description: "This report is accurate to the best of my knowledge.",
          required: true,
        }),
        f({ id: "signature", type: "signature", label: "Signature" }),
      ],
    },
  },
  {
    key: "guest-feedback",
    title: "Guest feedback",
    description: "Capture guest comments so nothing gets lost between shifts.",
    icon: "💬",
    schema: {
      version: 1,
      fields: [
        f({ id: "overall", type: "rating", label: "Overall experience", required: true }),
        f({ id: "said", type: "long_text", label: "What did the guest say?", required: true }),
        f({
          id: "kind",
          type: "select",
          label: "Type",
          options: opts("Compliment", "Complaint", "Suggestion"),
        }),
        f({ id: "follow_up", type: "yes_no", label: "Does this need a follow-up?" }),
      ],
    },
  },
];
