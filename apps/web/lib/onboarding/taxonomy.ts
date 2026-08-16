/**
 * The hospitality department taxonomy — ONE ordered table that answers three
 * questions about a team name:
 *
 *   • which icon does it get?          `defaultDeptIcon("Front Desk")` → 🛎️
 *   • what else means the same thing?  `departmentFamily("Front Desk")` → "front_office"
 *   • who works there?                 `titlesForDepartment("Kitchen")` → chef titles
 *
 * The FAMILY is the important one. Department names arrive from three places
 * that don't agree with each other — the per-property-type presets, the AI
 * plan, and whatever the user types — so "Front Office", "Front Desk" and
 * "Reception" all show up in the same product. Deduping on the literal string
 * let the onboarding wizard offer "Front Desk" as a suggestion to a hotel that
 * had already selected "Front Office", and the same for Maintenance vs
 * "Engineering & Maintenance" and Events vs "Sales & Events".
 *
 * **Families are SYNONYMS, not a hierarchy.** Kitchen, Bar and Front of House
 * are deliberately their OWN families rather than children of Food & Beverage:
 * a restaurant legitimately runs Kitchen and Bar as separate teams, and
 * collapsing them would hide real choices to fix a cosmetic duplicate. Only
 * names that a hotelier would call the same team share a family.
 *
 * ORDER MATTERS — first match wins, so specific patterns precede general ones.
 * "Front of House" must be tested before "Front Office"/"front desk", and
 * "Food & Beverage" before the bar patterns, or the wrong family wins.
 * Client-safe: pure data + regex, no imports.
 */

export type DepartmentFamily =
  | "front_of_house"
  | "front_office"
  | "concierge"
  | "reservations"
  | "housekeeping"
  | "laundry"
  | "food_beverage"
  | "kitchen"
  | "bar"
  | "maintenance"
  | "sales_events"
  | "spa"
  | "fitness"
  | "pool"
  | "security"
  | "hr"
  | "finance"
  | "it"
  | "transport"
  | "stores"
  | "grounds"
  | "management"
  | "operations";

type Entry = {
  family: DepartmentFamily;
  /** First match wins — see the ordering note above. */
  re: RegExp;
  icon: string;
  /** Job titles offered when an invitee is put on a team of this family. */
  titles: string[];
};

const TAXONOMY: Entry[] = [
  {
    // Before `front_office`: "Front of House" contains "front".
    family: "front_of_house",
    re: /front\s*of\s*house|\bfoh\b|wait\s*staff|waiting\s*staff|servers?\b|floor\s*team/i,
    icon: "🤝",
    titles: [
      "Front of House Manager",
      "Head Waiter",
      "Server",
      "Host",
      "Runner",
      "Busser",
    ],
  },
  {
    family: "front_office",
    re: /front\s*office|front\s*desk|reception|guest\s*(services?|relations?|experience)/i,
    icon: "🛎️",
    titles: [
      "Front Office Manager",
      "Duty Manager",
      "Receptionist",
      "Guest Relations Manager",
      "Night Auditor",
      "Porter",
    ],
  },
  {
    family: "concierge",
    re: /concierge/i,
    icon: "🧭",
    titles: ["Head Concierge", "Concierge", "Guest Services Agent"],
  },
  {
    family: "reservations",
    re: /reservation|revenue|booking\s*office/i,
    icon: "📖",
    titles: [
      "Reservations Manager",
      "Reservations Agent",
      "Revenue Manager",
    ],
  },
  {
    family: "laundry",
    re: /laundry|linen|dry\s*clean/i,
    icon: "🧺",
    titles: ["Laundry Manager", "Laundry Attendant", "Presser"],
  },
  {
    family: "housekeeping",
    re: /housekeep|room\s*attendant|chamber\s*maid|\bcleaning\b|cleaners?\b/i,
    icon: "🧹",
    titles: [
      "Head Housekeeper",
      "Housekeeping Supervisor",
      "Room Attendant",
      "Public Area Attendant",
      "Houseman",
    ],
  },
  {
    // Before the bar + kitchen patterns.
    family: "food_beverage",
    re: /food\s*(&|and)?\s*bever|\bf\s*&\s*b\b|\bf&b\b|restaurant|dining|catering|banqueting\s*food/i,
    icon: "🍽️",
    titles: [
      "F&B Manager",
      "Restaurant Manager",
      "Assistant F&B Manager",
      "Head Waiter",
      "Server",
    ],
  },
  {
    family: "kitchen",
    re: /kitchen|culinary|\bchefs?\b|back\s*of\s*house|\bboh\b|pastry|bakery/i,
    icon: "👨‍🍳",
    titles: [
      "Executive Chef",
      "Head Chef",
      "Sous Chef",
      "Chef de Partie",
      "Commis Chef",
      "Kitchen Porter",
    ],
  },
  {
    family: "bar",
    re: /\bbars?\b|bartend|barista|mixolog|\bdrinks\b|beverage\s*service|coffee|caf[eé]/i,
    icon: "🍸",
    titles: [
      "Bar Manager",
      "Head Bartender",
      "Bartender",
      "Barista",
      "Barback",
    ],
  },
  {
    family: "maintenance",
    re: /mainten|engineer|facilit|technical|repairs?\b|handy/i,
    icon: "🔧",
    titles: [
      "Chief Engineer",
      "Maintenance Manager",
      "Maintenance Technician",
      "Electrician",
      "Plumber",
      "Handyman",
    ],
  },
  {
    family: "sales_events",
    re: /sales|marketing|events?\b|banquet|conferenc|weddings?|\bmice\b/i,
    icon: "📅",
    titles: [
      "Sales Manager",
      "Events Manager",
      "Banquet Manager",
      "Event Coordinator",
      "Marketing Manager",
    ],
  },
  {
    family: "spa",
    re: /\bspa\b|wellness|massage|therap|beauty|salon/i,
    icon: "💆",
    titles: [
      "Spa Manager",
      "Spa Therapist",
      "Massage Therapist",
      "Spa Receptionist",
      "Beautician",
    ],
  },
  {
    family: "fitness",
    re: /\bgym\b|fitness|health\s*club|yoga/i,
    icon: "🏋️",
    titles: ["Fitness Manager", "Personal Trainer", "Fitness Instructor"],
  },
  {
    family: "pool",
    re: /\bpools?\b|\bbeach\b|water\s*sports/i,
    icon: "🏊",
    titles: ["Pool Manager", "Lifeguard", "Pool Attendant", "Beach Attendant"],
  },
  {
    family: "security",
    re: /security|\bguards?\b|safety/i,
    icon: "🛡️",
    titles: ["Security Manager", "Security Officer", "Night Guard"],
  },
  {
    family: "hr",
    re: /\bhr\b|human\s*resource|\bpeople\b|talent|training|recruit/i,
    icon: "👥",
    titles: ["HR Manager", "Training Manager", "Recruiter", "HR Officer"],
  },
  {
    family: "finance",
    re: /financ|account|payroll|billing|\bcashier/i,
    icon: "💰",
    titles: [
      "Financial Controller",
      "Accountant",
      "Bookkeeper",
      "Accounts Clerk",
      "Cashier",
    ],
  },
  {
    family: "it",
    re: /\bi\.?t\.?\b|technolog|systems|network/i,
    icon: "💻",
    titles: ["IT Manager", "Systems Administrator", "IT Support"],
  },
  {
    family: "transport",
    re: /transport|drivers?\b|shuttle|valet|chauffeur|fleet/i,
    icon: "🚐",
    titles: ["Transport Manager", "Driver", "Chauffeur", "Valet"],
  },
  {
    family: "stores",
    re: /purchas|procure|\bstores?\b|inventory|\bstock\b|receiving|warehouse|supply/i,
    icon: "📦",
    titles: ["Purchasing Manager", "Storekeeper", "Receiving Clerk"],
  },
  {
    family: "grounds",
    re: /grounds|garden|landscap|horticult/i,
    icon: "🌿",
    titles: ["Head Gardener", "Groundskeeper", "Gardener"],
  },
  {
    // Late: "office" is deliberately NOT a pattern here — it would swallow
    // "Front Office", which is a different team entirely.
    family: "management",
    re: /management|\badmin|leadership|executive\s*office|\bgm\b/i,
    icon: "📋",
    titles: [
      "General Manager",
      "Operations Manager",
      "Deputy Manager",
      "Duty Manager",
      "Owner",
      "Executive Assistant",
    ],
  },
  {
    family: "operations",
    re: /operation|\bops\b/i,
    icon: "🗂️",
    titles: [
      "Operations Manager",
      "Duty Manager",
      "Shift Supervisor",
      "Operations Coordinator",
    ],
  },
];

const FALLBACK_ICON = "🏷️";

/**
 * Titles for someone on NO team — which is a real answer, not a missing one.
 * A General Manager doesn't sit in Housekeeping or Front Office; they run the
 * property across all of them. Properties that create an explicit
 * "Management" team can put the GM there (see the `management` family), but
 * the hotel presets don't create one, so leadership needs a home that isn't a
 * department. This is that list, and the wizard labels the option
 * "Property-wide" rather than "No team yet" so it reads as a choice.
 */
export const LEADERSHIP_TITLES = [
  "General Manager",
  "Owner",
  "Deputy General Manager",
  "Operations Manager",
  "Executive Assistant",
  "Consultant",
];

/**
 * Titles for a team whose name we don't recognise. Deliberately NOT the
 * leadership list: an unrecognised team is some department we haven't got a
 * pattern for, and offering "General Manager" as the top suggestion for a
 * team called "Dive Centre" is worse than offering nothing specific.
 */
export const GENERIC_TEAM_TITLES = [
  "Manager",
  "Supervisor",
  "Team Lead",
  "Coordinator",
  "Team Member",
];

function match(name: string): Entry | null {
  for (const entry of TAXONOMY) {
    if (entry.re.test(name)) return entry;
  }
  return null;
}

/** The emoji a department gets when nobody picked one. */
export function defaultDeptIcon(name: string): string {
  return match(name)?.icon ?? FALLBACK_ICON;
}

/**
 * A canonical key for "this is the same team, differently worded". Unknown
 * names fall back to their own normalized text, so two teams we don't
 * recognise still dedupe on an exact (case/spacing-insensitive) match rather
 * than silently collapsing into one bucket.
 */
export function departmentFamily(name: string): string {
  const hit = match(name);
  if (hit) return hit.family;
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Do these two team names mean the same team? */
export function isSameDepartment(a: string, b: string): boolean {
  return departmentFamily(a) === departmentFamily(b);
}

/**
 * Job titles to offer for someone on this team. Three cases, deliberately
 * distinct (see the two title lists above):
 *
 *   no team      → leadership, because "property-wide" is where a GM lives
 *   known team   → that department's ladder, most senior first
 *   unknown team → a generic ladder, NOT leadership
 *
 * The field stays free text regardless; these only populate its datalist.
 */
export function titlesForDepartment(name: string | null | undefined): string[] {
  if (!name?.trim()) return LEADERSHIP_TITLES;
  return match(name)?.titles ?? GENERIC_TEAM_TITLES;
}
