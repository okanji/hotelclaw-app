/**
 * Onboarding SOP template catalog — the CLIENT-SAFE half (ids, titles,
 * selection metadata). The actual document bodies live in
 * `template-bodies.ts` and are only imported server-side, so the wizard
 * bundle never ships kilobytes of SOP prose.
 *
 * Doctrine (mirrors the automations-suggestions pattern): templates are
 * HARDCODED and the AI only SELECTS + personalizes around them — it picks
 * which templates fit the property, may retitle them, and adds a one-line
 * property-specific intro. It never authors SOP structure from scratch, so
 * a bad model turn can at worst mislabel a good document, never seed a
 * hallucinated procedure.
 */

export type SopTemplateMeta = {
  id: string;
  title: string;
  /** Single emoji, mirrors plan.docs icon. */
  icon: string;
  /** One-liner shown to the AI planner and on the build screen's cards. */
  summary: string;
  /** Selection signals — matches when ANY listed value matches the answers
   *  (or `always`). Property types use the wizard's chip ids. */
  appliesTo: {
    always?: boolean;
    types?: string[];
    operations?: string[];
    priorities?: string[];
  };
};

const HOTELISH = ["hotel", "resort", "hostel", "boutique-hotel", "full-service-hotel"];

export const SOP_TEMPLATES: SopTemplateMeta[] = [
  {
    id: "emergency-procedures",
    title: "Emergency & incident procedures",
    icon: "🚨",
    summary:
      "Who to call, evacuation basics, and how to record an incident — the doc every workplace needs on day one.",
    appliesTo: { always: true },
  },
  {
    id: "shift-handover",
    title: "Shift handover playbook",
    icon: "🔁",
    summary:
      "What the outgoing shift writes down and where, so the next shift starts informed instead of surprised.",
    appliesTo: { always: true },
  },
  {
    id: "guest-complaint",
    title: "Guest complaint handling SOP",
    icon: "🤝",
    summary:
      "The LEARN steps for handling a complaint on the spot, when to escalate, and how to log it.",
    appliesTo: { types: [...HOTELISH, "restaurant", "cafe-bar"], priorities: ["Guest feedback"] },
  },
  {
    id: "new-hire-onboarding",
    title: "New team member onboarding",
    icon: "🧭",
    summary:
      "First-day and first-week checklist for bringing a new hire up to speed.",
    appliesTo: { always: true },
  },
  {
    id: "opening-checklist",
    title: "Opening checklist",
    icon: "🌅",
    summary: "Everything to check and switch on before the first guest walks in.",
    appliesTo: {
      types: ["restaurant", "cafe-bar"],
      operations: ["restaurant", "bar"],
      priorities: ["Daily checklists"],
    },
  },
  {
    id: "closing-checklist",
    title: "Closing checklist",
    icon: "🌙",
    summary: "End-of-day shutdown, cash-up, and security walkthrough.",
    appliesTo: {
      types: ["restaurant", "cafe-bar"],
      operations: ["restaurant", "bar"],
      priorities: ["Daily checklists"],
    },
  },
  {
    id: "housekeeping-room",
    title: "Room cleaning standards",
    icon: "🛏️",
    summary:
      "The room-by-room cleaning sequence and the checks that make a room guest-ready.",
    appliesTo: { types: HOTELISH, operations: ["rooms"] },
  },
  {
    id: "maintenance-triage",
    title: "Maintenance request triage SOP",
    icon: "🔧",
    summary:
      "How reported issues get prioritized, who picks them up, and what counts as drop-everything urgent.",
    appliesTo: { priorities: ["Maintenance requests"] },
  },
];

const byId = new Map(SOP_TEMPLATES.map((t) => [t.id, t]));

export function sopTemplateById(id: string): SopTemplateMeta | undefined {
  return byId.get(id);
}

/** Deterministic selection: which templates fit this property, most broadly
 *  applicable first. Callers cap the count (the plan allows 6 docs). */
export function selectSopTemplates(answers: {
  propertyType: string;
  operations: string[];
  priorities: string[];
}): SopTemplateMeta[] {
  const ops = new Set(answers.operations);
  const prios = new Set(answers.priorities);
  return SOP_TEMPLATES.filter((t) => {
    const a = t.appliesTo;
    if (a.always) return true;
    if (a.types?.includes(answers.propertyType)) return true;
    if (a.operations?.some((o) => ops.has(o))) return true;
    if (a.priorities?.some((p) => prios.has(p))) return true;
    return false;
  });
}
