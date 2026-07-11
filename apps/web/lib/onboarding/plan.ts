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
  /** What the property runs on-site ("rooms", "restaurant", "spa", "tours",
   *  "rentals"…) — drives bookings/chatbot/form generation. */
  operations: z.array(z.string().max(40)).max(12).default([]),
  /** How guests reach the property ("walk_in", "phone", "whatsapp", "email",
   *  "ota", "website") — drives chatbot channels + intake forms. */
  guestContact: z.array(z.string().max(40)).max(10).default([]),
  /** Optional free-text: "how does your property run day-to-day" — fed to the
   *  AI planner to customize the build. */
  notes: z.string().max(1000).default(""),
  invites: z
    .array(
      z.object({
        email: z.string().email().max(254),
        role: z.enum(["manager", "staff"]),
        /** Inviter-provided pre-fill — carried onto the invite row. */
        name: z.string().max(120).optional(),
        title: z.string().max(80).optional(),
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

/** A single form the plan will publish. */
export const PlanFormSchema = z.object({
  title: z.string().min(1).max(120),
  description: z.string().max(500),
  /** A single emoji for the form icon. */
  icon: z.string().max(8).optional(),
  fields: z.array(PlanFormFieldSchema).min(1).max(12),
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
  /** Published, ready-to-share forms derived from the property's priorities /
   *  operations (maintenance request, guest feedback, incident report…). */
  forms: z.array(PlanFormSchema).max(4).default([]),
  /** Starter SOP / playbook documents (titled stubs the team fills in) drawn
   *  from their departments + priorities. */
  docs: z
    .array(
      z.object({
        title: z.string().min(1).max(120),
        icon: z.string().max(8).optional(),
      }),
    )
    .max(6)
    .default([]),
  /** The owner's job title, seeded onto their membership (org chart). */
  orgTitle: z.string().max(80).nullable().default(null),
  /** 2–3 warm sentences posted to #general as the owner. */
  welcomeMessage: z.string().min(1).max(1000),
});

export type OnboardingPlan = z.infer<typeof PlanSchema>;
export type PlanFormField = z.infer<typeof PlanFormFieldSchema>;
export type PlanForm = z.infer<typeof PlanFormSchema>;

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

  const seenFormTitles = new Set<string>();
  const forms = plan.forms
    .slice(0, 4)
    .map((f) => ({
      title: f.title.trim().slice(0, 120),
      description: f.description.trim().slice(0, 500),
      ...(f.icon ? { icon: clampIcon(f.icon, "📋") } : {}),
      fields: f.fields.slice(0, 12),
    }))
    .filter((f) => {
      const key = f.title.toLowerCase();
      if (!f.title || !f.fields.length || seenFormTitles.has(key)) return false;
      seenFormTitles.add(key);
      return true;
    });

  const seenDocTitles = new Set<string>();
  const docs = plan.docs
    .slice(0, 6)
    .map((d) => ({
      title: d.title.trim().slice(0, 120),
      ...(d.icon ? { icon: clampIcon(d.icon, "📄") } : {}),
    }))
    .filter((d) => {
      const key = d.title.toLowerCase();
      if (!d.title || seenDocTitles.has(key)) return false;
      seenDocTitles.add(key);
      return true;
    });

  return {
    spaces,
    extraChannels,
    labels,
    forms,
    docs,
    orgTitle: plan.orgTitle ? plan.orgTitle.trim().slice(0, 80) || null : null,
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

const MAINTENANCE_FORM: PlanForm = {
  title: "Maintenance request",
  description:
    "Spotted something broken? Log it here so the maintenance team can pick it up.",
  icon: "🔧",
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

const GUEST_FEEDBACK_FORM: PlanForm = {
  title: "Guest feedback",
  description: "Capture guest comments so nothing gets lost between shifts.",
  icon: "💬",
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

const INCIDENT_FORM: PlanForm = {
  title: "Incident report",
  description:
    "Log accidents, security issues, or anything that needs a record and follow-up.",
  icon: "🚨",
  fields: [
    { type: "short_text", label: "Where did it happen?", required: true },
    { type: "long_text", label: "What happened?", required: true },
    {
      type: "select",
      label: "Severity",
      required: true,
      options: ["Minor", "Moderate", "Serious"],
    },
    { type: "short_text", label: "Who was involved?" },
    { type: "yes_no", label: "Were the authorities contacted?" },
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

  // Build a small set of forms from what they told us. Maintenance + guest
  // feedback are the workhorses; incident reports show up for hotels/resorts.
  const forms: PlanForm[] = [];
  if (priorities.has("Maintenance requests")) forms.push(MAINTENANCE_FORM);
  if (priorities.has("Guest feedback") || isHotel || isRestaurant) {
    forms.push(GUEST_FEEDBACK_FORM);
  }
  if (isHotel && forms.length < 4) forms.push(INCIDENT_FORM);
  // Never leave a new workspace with zero forms — seed the maintenance one.
  if (forms.length === 0) forms.push(MAINTENANCE_FORM);

  // Starter SOP / playbook docs — titled stubs the team fills in, drawn from
  // their priorities and property type.
  const docs: OnboardingPlan["docs"] = [];
  if (priorities.has("Shift handovers")) {
    docs.push({ title: "Shift handover playbook", icon: "🔁" });
  }
  if (priorities.has("Daily checklists")) {
    docs.push({ title: "Opening checklist", icon: "🌅" });
    docs.push({ title: "Closing checklist", icon: "🌙" });
  }
  if (priorities.has("Guest feedback") || isHotel || isRestaurant) {
    docs.push({ title: "Guest complaint handling SOP", icon: "🤝" });
  }
  if (isHotel && docs.length < 6) {
    docs.push({ title: "Emergency & incident procedures", icon: "🚨" });
  }
  if (docs.length === 0) {
    docs.push({ title: "Standard operating procedures", icon: "📄" });
  }

  const orgTitle = answers.roleTitle.trim() || null;

  const welcomeMessage = [
    `Welcome to ${answers.propertyName}'s workspace! 👋`,
    `Each team has its own space and channel, and there ${
      forms.length === 1 ? "'s a" : " are"
    } ${forms.length} ready-to-use form${forms.length === 1 ? "" : "s"} (${forms
      .map((f) => `"${f.title}"`)
      .join(", ")}).`,
    `Invite the rest of the team whenever you're ready — everything here is yours to reshape.`,
  ].join(" ");

  return sanitizePlan({
    spaces,
    extraChannels: extraChannels.slice(0, 4),
    labels: labels.slice(0, 8),
    forms: forms.slice(0, 4),
    docs: docs.slice(0, 6),
    orgTitle,
    welcomeMessage,
  });
}

// ─── Bookable services (deterministic, from the "what do you operate" answer) ─
//
// Kept out of the AI plan on purpose: booking schedules are structured config
// the availability engine parses, so we generate them deterministically rather
// than trust a model to emit valid weekly-hours JSON. All capacity-mode (no
// floor-plan resources needed); staff refine hours/timezone and go public later.

export type StarterBookingService = {
  name: string;
  kind: "table" | "appointment" | "tour" | "event" | "rental" | "other";
  bookingMode: "capacity" | "tables" | "rental";
  emoji: string;
  description: string;
  schedule: Record<string, unknown>;
};

const everyDay = (ranges: { start: string; end: string }[]) =>
  Object.fromEntries(
    ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, ranges]),
  );

/** Starter bookable services keyed off `answers.operations`. Restaurant, spa,
 *  and tours map cleanly to capacity-mode services; rooms/bar/events/rentals
 *  need resource/date setup, so they're left for the staff to add. */
export function starterBookingServices(
  operations: string[],
): StarterBookingService[] {
  const ops = new Set(operations);
  const out: StarterBookingService[] = [];

  if (ops.has("restaurant")) {
    out.push({
      name: "Restaurant",
      kind: "table",
      bookingMode: "capacity",
      emoji: "🍽️",
      description: "Table reservations for lunch and dinner service.",
      schedule: {
        version: 1,
        slotIntervalMinutes: 30,
        durationMinutes: 90,
        capacityPerSlot: 40,
        countPartySize: true,
        maxPartySize: 8,
        minNoticeMinutes: 30,
        horizonDays: 60,
        weekly: everyDay([
          { start: "12:00", end: "14:30" },
          { start: "18:00", end: "21:30" },
        ]),
      },
    });
  }
  if (ops.has("spa")) {
    out.push({
      name: "Spa appointment",
      kind: "appointment",
      bookingMode: "capacity",
      emoji: "💆",
      description: "Book a treatment with one of our therapists.",
      schedule: {
        version: 1,
        slotIntervalMinutes: 30,
        durationMinutes: 60,
        capacityPerSlot: 3,
        countPartySize: false,
        maxPartySize: 2,
        minNoticeMinutes: 120,
        horizonDays: 60,
        weekly: everyDay([{ start: "09:00", end: "18:00" }]),
      },
    });
  }
  if (ops.has("tours")) {
    out.push({
      name: "Tour / activity",
      kind: "tour",
      bookingMode: "capacity",
      emoji: "🗺️",
      description: "Reserve seats on a guided tour or activity.",
      schedule: {
        version: 1,
        slotIntervalMinutes: 60,
        durationMinutes: 120,
        capacityPerSlot: 12,
        countPartySize: true,
        maxPartySize: 8,
        minNoticeMinutes: 180,
        horizonDays: 60,
        weekly: everyDay([{ start: "10:00", end: "16:00" }]),
      },
    });
  }
  return out;
}
