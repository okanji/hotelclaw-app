import { z } from "zod";
import {
  FORM_FIELD_TYPES,
  newFieldId,
  type FormSchema,
} from "@/lib/forms/schema";
import type { EntityColor } from "@/lib/db/types";

/**
 * Onboarding plan — the typed contract between the setup wizard, the
 * AI plan endpoint (/api/onboarding/plan), and the `createWorkspace`
 * server action. The AI proposes a plan in this exact shape; when the
 * model is unavailable (or returns garbage) `deterministicPlan()` builds
 * the same shape from a small table keyed by property type, so the
 * wizard never dead-ends.
 *
 * Plain module on purpose (no "server-only"): the wizard imports the
 * answer types, and both the route and the action import the schemas.
 */

export const ENTITY_COLORS = [
  "slate",
  "blue",
  "green",
  "amber",
  "rose",
  "violet",
] as const satisfies readonly EntityColor[];

// ─── Answers (what the wizard collects) ─────────────────────────────────────

export const AnswersSchema = z.object({
  propertyName: z.string().min(1).max(120),
  /** One of the wizard's type chips ("boutique-hotel", "restaurant", …). */
  propertyType: z.string().min(1).max(40),
  teamSize: z.string().min(1).max(20),
  departments: z
    .array(
      z.object({
        name: z.string().min(1).max(60),
        icon: z.string().max(8).optional(),
        color: z.enum(ENTITY_COLORS).optional(),
      }),
    )
    .max(12),
  roleTitle: z.string().max(80).default(""),
  priorities: z.array(z.string().max(60)).max(12),
  invites: z
    .array(
      z.object({
        email: z.string().email().max(254),
        role: z.enum(["manager", "staff"]),
      }),
    )
    .max(20)
    .default([]),
});

export type OnboardingAnswers = z.infer<typeof AnswersSchema>;
export type OnboardingAnswersInput = z.input<typeof AnswersSchema>;

// ─── Plan (what gets seeded) ────────────────────────────────────────────────

const SLUG_RE = /^[a-z0-9-]+$/;

/** Inline field shape the AI emits; mapped to lib/forms/schema field ids
 *  via `planFormToFormSchema()` before insert. */
export const PlanFormFieldSchema = z.object({
  type: z.enum(FORM_FIELD_TYPES),
  label: z.string().min(1).max(120),
  description: z.string().max(300).optional(),
  required: z.boolean().optional(),
  /** For select / multi_select — plain labels, ids are assigned server-side. */
  options: z.array(z.string().min(1).max(80)).max(12).optional(),
  /** For rating — scale size, 3–10. */
  maxRating: z.number().int().min(3).max(10).optional(),
});

export const PlanSchema = z.object({
  spaces: z
    .array(
      z.object({
        name: z.string().min(1).max(60),
        /** A single emoji. */
        icon: z.string().min(1).max(8),
        color: z.enum(ENTITY_COLORS),
        channelSlug: z.string().min(1).max(40).regex(SLUG_RE),
      }),
    )
    .max(8),
  extraChannels: z
    .array(
      z.object({
        slug: z.string().min(1).max(40).regex(SLUG_RE),
        topic: z.string().max(120),
      }),
    )
    .max(4),
  labels: z
    .array(
      z.object({
        name: z.string().min(1).max(40),
        color: z.enum(ENTITY_COLORS),
      }),
    )
    .max(8),
  starterForm: z
    .object({
      title: z.string().min(1).max(120),
      description: z.string().max(500),
      fields: z.array(PlanFormFieldSchema).min(1).max(12),
    })
    .nullable(),
  /** 2–3 warm sentences posted to #general as the owner. */
  welcomeMessage: z.string().min(1).max(1000),
});

export type OnboardingPlan = z.infer<typeof PlanSchema>;
export type PlanFormField = z.infer<typeof PlanFormFieldSchema>;

// ─── Helpers ────────────────────────────────────────────────────────────────

export function slugifyChannel(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40)
      .replace(/-+$/g, "") || "channel"
  );
}

const DEPT_ICONS: Array<[RegExp, string]> = [
  [/front\s*office|reception|front\s*desk/i, "🛎️"],
  [/housekeep|clean/i, "🧹"],
  [/food|beverage|f&b|restaurant|dining/i, "🍽️"],
  [/kitchen|culinary|chef/i, "👨‍🍳"],
  [/bar|drinks|beverage/i, "🍸"],
  [/engineer|mainten|facilit/i, "🔧"],
  [/sales|event|banquet|marketing/i, "📅"],
  [/front\s*of\s*house|service|floor/i, "🤝"],
  [/management|admin|office/i, "📋"],
  [/spa|wellness|pool/i, "💆"],
  [/security/i, "🛡️"],
  [/hr|people/i, "👥"],
];

export function defaultDeptIcon(name: string): string {
  for (const [re, icon] of DEPT_ICONS) {
    if (re.test(name)) return icon;
  }
  return "🏷️";
}

/** Round-robin EntityColor assignment, stable by index. */
export function colorAt(i: number): EntityColor {
  return ENTITY_COLORS[i % ENTITY_COLORS.length];
}

/** Single emoji-ish guard — keeps icons to one glyph cluster, never text. */
function clampIcon(icon: string | undefined, fallback: string): string {
  const trimmed = (icon ?? "").trim();
  if (!trimmed) return fallback;
  // Take the first grapheme-ish cluster; cap raw length defensively.
  const first = [...trimmed][0] ?? "";
  const cluster = trimmed.slice(0, Math.max(first.length, 1));
  // Reject plain ascii "icons" the model might emit ("FO", "-").
  if (/^[\x20-\x7e]+$/.test(cluster)) return fallback;
  return cluster.slice(0, 8);
}

/**
 * Normalize an already-shape-valid plan: cap counts, sanitize slugs and
 * icons, dedupe channel slugs across spaces + extras. Never trust the
 * client blob (or the model) blindly.
 */
export function sanitizePlan(plan: OnboardingPlan): OnboardingPlan {
  const seenSlugs = new Set<string>();
  const uniqueSlug = (raw: string) => {
    let slug = slugifyChannel(raw);
    let n = 2;
    while (seenSlugs.has(slug)) {
      slug = `${slugifyChannel(raw).slice(0, 36)}-${n++}`;
    }
    seenSlugs.add(slug);
    return slug;
  };

  const spaces = plan.spaces.slice(0, 8).map((s) => ({
    name: s.name.trim().slice(0, 60),
    icon: clampIcon(s.icon, defaultDeptIcon(s.name)),
    color: s.color,
    channelSlug: uniqueSlug(s.channelSlug || s.name),
  }));

  const extraChannels = plan.extraChannels
    .slice(0, 4)
    .filter((c) => slugifyChannel(c.slug) !== "general" || !seenSlugs.has("general"))
    .map((c) => ({
      slug: uniqueSlug(c.slug),
      topic: c.topic.trim().slice(0, 120),
    }));

  const seenLabels = new Set<string>();
  const labels = plan.labels
    .slice(0, 8)
    .map((l) => ({ name: l.name.trim().slice(0, 40), color: l.color }))
    .filter((l) => {
      const key = l.name.toLowerCase();
      if (!l.name || seenLabels.has(key)) return false;
      seenLabels.add(key);
      return true;
    });

  const starterForm = plan.starterForm
    ? {
        title: plan.starterForm.title.trim().slice(0, 120),
        description: plan.starterForm.description.trim().slice(0, 500),
        fields: plan.starterForm.fields.slice(0, 12),
      }
    : null;

  return {
    spaces,
    extraChannels,
    labels,
    starterForm,
    welcomeMessage: plan.welcomeMessage.trim().slice(0, 1000),
  };
}

/** Map the plan's inline form fields into the persisted FormSchema shape,
 *  assigning real field/option ids (same mapping AI form generation uses). */
export function planFormToFormSchema(fields: PlanFormField[]): FormSchema {
  return {
    version: 1,
    fields: fields.map((f) => ({
      id: newFieldId(),
      type: f.type,
      label: f.label,
      ...(f.description ? { description: f.description } : {}),
      ...(f.required !== undefined ? { required: f.required } : {}),
      ...(f.options && (f.type === "select" || f.type === "multi_select")
        ? { options: f.options.map((label) => ({ id: newFieldId(), label })) }
        : {}),
      ...(f.maxRating && f.type === "rating" ? { maxRating: f.maxRating } : {}),
    })),
  };
}

// ─── Deterministic fallback ─────────────────────────────────────────────────

const HOTEL_TYPES = new Set([
  "boutique-hotel",
  "full-service-hotel",
  "resort",
  "hostel",
]);
const RESTAURANT_TYPES = new Set(["restaurant", "cafe-bar"]);

const MAINTENANCE_FORM: NonNullable<OnboardingPlan["starterForm"]> = {
  title: "Maintenance request",
  description:
    "Spotted something broken? Log it here so the maintenance team can pick it up.",
  fields: [
    { type: "short_text", label: "Location", required: true },
    { type: "long_text", label: "What needs fixing?", required: true },
    {
      type: "select",
      label: "Urgency",
      required: true,
      options: ["Low — whenever", "Normal — this week", "Urgent — today"],
    },
    { type: "yes_no", label: "Is the area safe to use in the meantime?" },
  ],
};

const GUEST_FEEDBACK_FORM: NonNullable<OnboardingPlan["starterForm"]> = {
  title: "Guest feedback",
  description: "Capture guest comments so nothing gets lost between shifts.",
  fields: [
    { type: "rating", label: "Overall experience", required: true, maxRating: 5 },
    { type: "long_text", label: "What did the guest say?", required: true },
    {
      type: "select",
      label: "Type",
      options: ["Compliment", "Complaint", "Suggestion"],
    },
    { type: "yes_no", label: "Does this need a follow-up?" },
  ],
};

/**
 * The no-model plan. Keeps the user's department names verbatim, fills
 * icon/color/slug deterministically, and derives channels, labels, and the
 * one starter form from property type + priorities. Also runs whenever the
 * AI call fails or the client posts an invalid plan.
 */
export function deterministicPlan(answers: OnboardingAnswers): OnboardingPlan {
  const isHotel = HOTEL_TYPES.has(answers.propertyType);
  const isRestaurant = RESTAURANT_TYPES.has(answers.propertyType);
  const priorities = new Set(answers.priorities);

  const spaces = answers.departments.slice(0, 8).map((d, i) => ({
    name: d.name,
    icon: d.icon?.trim() || defaultDeptIcon(d.name),
    color: d.color ?? colorAt(i),
    channelSlug: slugifyChannel(d.name),
  }));

  const extraChannels: OnboardingPlan["extraChannels"] = [
    {
      slug: "general",
      topic: `The whole ${answers.propertyName} team — announcements and day-to-day chat`,
    },
  ];
  if (priorities.has("Maintenance requests")) {
    extraChannels.push({
      slug: "maintenance-requests",
      topic: "Report and track anything that needs fixing",
    });
  }
  if (priorities.has("Shift handovers") && extraChannels.length < 4) {
    extraChannels.push({
      slug: "handovers",
      topic: "End-of-shift notes so the next shift starts informed",
    });
  }

  const labels: OnboardingPlan["labels"] = [
    { name: "Urgent", color: "rose" },
    { name: "Daily", color: "blue" },
    { name: "Follow up", color: "amber" },
  ];
  if (priorities.has("Guest feedback")) {
    labels.push({ name: "Guest issue", color: "violet" });
  }
  if (priorities.has("Maintenance requests")) {
    labels.push({ name: "Maintenance", color: "slate" });
  }
  if (answers.departments.some((d) => /housekeep|clean/i.test(d.name))) {
    labels.push({ name: "Deep clean", color: "green" });
  }
  if (priorities.has("Daily checklists") && labels.length < 8) {
    labels.push({ name: "Checklist", color: "green" });
  }

  const starterForm = priorities.has("Maintenance requests")
    ? MAINTENANCE_FORM
    : priorities.has("Guest feedback") || isHotel || isRestaurant
      ? GUEST_FEEDBACK_FORM
      : MAINTENANCE_FORM;

  const welcomeMessage = [
    `Welcome to ${answers.propertyName}'s workspace! 👋`,
    `Each team has its own space and channel, and there's a starter "${starterForm.title}" form ready to use.`,
    `Invite the rest of the team whenever you're ready — everything here is yours to reshape.`,
  ].join(" ");

  return sanitizePlan({
    spaces,
    extraChannels: extraChannels.slice(0, 4),
    labels: labels.slice(0, 8),
    starterForm,
    welcomeMessage,
  });
}
