"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Chip as ChipBase } from "@/components/ui/chip";
import { Eyebrow as EyebrowBase } from "@/components/ui/eyebrow";
import {
  GuestBigInput,
  GuestError,
  GuestGhostButton as GhostButton,
  GuestHint,
  GuestInput,
  GuestPrimaryButton as PrimaryButton,
  GuestQuestion as Question,
  GuestSelect,
} from "@/components/guest/ui";
import {
  departmentFamily,
  isSameDepartment,
  titlesForDepartment,
} from "@/lib/onboarding/taxonomy";
import type { EntityColor } from "@/lib/db/types";
import {
  PlanSchema,
  colorAt,
  defaultDeptIcon,
  starterBookingServices,
  type OnboardingAnswersInput,
  type OnboardingPlan,
} from "@/lib/onboarding/plan";
import { createWorkspace } from "./actions";

/**
 * The setup wizard — a full-screen, one-question-per-screen takeover in
 * its own warm-cream visual world (deliberately not the app shell's
 * palette). Seven beats: name → type/size → departments → role →
 * operations → invites → build. The build screen fetches the AI plan,
 * animates it assembling, runs `createWorkspace`, and lands the user in
 * their new workspace with everything already set up.
 *
 * Priorities and guest-contact channels are NOT asked — every property is
 * built with all of them on (the questions tested poorly; owners just want
 * the full setup). The answer fields still flow to the plan generator and
 * property_profiles with everything selected.
 */

// Palette + primitives come from the guest design system: `guest-*` tokens in
// globals.css and the kit in components/guest/ui.tsx. The wizard pins the
// guest tone on the shared Chip/Eyebrow once here so call sites stay terse.

function Chip(props: React.ComponentProps<typeof ChipBase>) {
  return <ChipBase tone="guest" {...props} />;
}

function Eyebrow({
  className,
  ...props
}: React.ComponentProps<typeof EyebrowBase>) {
  return <EyebrowBase tone="guest" className={cn("mb-3", className)} {...props} />;
}

// ─── Step data ──────────────────────────────────────────────────────────────

const PROPERTY_TYPES = [
  { id: "hotel", label: "Hotel" },
  { id: "resort", label: "Resort" },
  { id: "hostel", label: "Hostel" },
  { id: "restaurant", label: "Restaurant" },
  { id: "cafe-bar", label: "Café or bar" },
  { id: "other", label: "Other" },
] as const;

const TEAM_SIZES = ["Just me", "2–4", "5–10", "11–20", "21+"] as const;

const DEPARTMENT_PRESETS: Record<string, string[]> = {
  hotel: [
    "Front Office",
    "Housekeeping",
    "Food & Beverage",
    "Engineering & Maintenance",
    "Sales & Events",
  ],
  resort: [
    "Front Office",
    "Housekeeping",
    "Food & Beverage",
    "Engineering & Maintenance",
    "Spa & Wellness",
    "Sales & Events",
  ],
  hostel: ["Front Desk", "Housekeeping", "Events", "Maintenance"],
  restaurant: ["Front of House", "Kitchen", "Bar", "Management"],
  "cafe-bar": ["Front of House", "Bar", "Kitchen", "Management"],
  other: ["Operations", "Front of House", "Maintenance", "Management"],
};

// Teams that exist in real properties but aren't any type's default. They ride
// at the end of the suggestion list so a security team or a groundskeeping
// team is one tap rather than a typing exercise.
const EXTRA_DEPARTMENT_SUGGESTIONS = [
  "Spa & Wellness",
  "Security",
  "Reservations",
  "Concierge",
  "Grounds & Gardens",
  "Laundry",
  "Transport",
  "Stores & Purchasing",
  "Finance",
  "People & Training",
];

const ROLE_SUGGESTIONS = [
  "General Manager",
  "Operations Manager",
  "Owner",
  "Front Office Manager",
  "F&B Manager",
  "Head Housekeeper",
];

// Job-title suggestions are no longer one flat list — they come from
// `titlesForDepartment()` per invite row, keyed off that person's team, so a
// kitchen hire is offered chef titles and a property-wide hire is offered the
// leadership ladder. See lib/onboarding/taxonomy.ts.

const PRIORITY_OPTIONS = [
  "Shift handovers",
  "Task tracking",
  "Maintenance requests",
  "Team chat",
  "SOPs & docs",
  "Guest feedback",
  "Daily checklists",
  "Reporting & insights",
];

// What the property runs on-site — drives bookings services, chatbot actions,
// and operation-specific forms in the build plan.
//
// Each option carries a `blurb` saying what WE will set up, not what the thing
// is: the user knows what a spa is, what they can't know is that ticking it
// creates an appointment service with therapists and durations. Bare labels
// made this the one step people guessed at.
//
// Unknown ids are safe to add — `starterBookingServices()` matches only the
// handful it has templates for and everything else flows to the AI planner as
// context, so widening this list can't break the build.
type OperationOption = {
  id: string;
  label: string;
  emoji: string;
  blurb: string;
};

const OPERATION_GROUPS: { group: string; options: OperationOption[] }[] = [
  {
    group: "Stays",
    options: [
      {
        id: "rooms",
        label: "Rooms / stays",
        emoji: "🛏️",
        blurb: "Guest rooms, check-in and check-out, housekeeping rounds.",
      },
      {
        id: "rentals",
        label: "Rentals",
        emoji: "🚗",
        blurb: "Kit or vehicles guests take out by the hour or the day.",
      },
      {
        id: "parking",
        label: "Parking / valet",
        emoji: "🅿️",
        blurb: "Spaces guests reserve, or keys your team takes in.",
      },
    ],
  },
  {
    group: "Food & drink",
    options: [
      {
        id: "restaurant",
        label: "Restaurant",
        emoji: "🍽️",
        blurb: "Table reservations with party sizes and turn times.",
      },
      {
        id: "bar",
        label: "Bar",
        emoji: "🍸",
        blurb: "Walk-ins, tabs, and last orders.",
      },
      {
        id: "cafe",
        label: "Café / counter",
        emoji: "☕",
        blurb: "Quick counter service and takeaway orders.",
      },
      {
        id: "room_service",
        label: "Room service",
        emoji: "🛎️",
        blurb: "In-room orders routed straight to the kitchen.",
      },
      {
        id: "catering",
        label: "Catering",
        emoji: "🧁",
        blurb: "Private and off-site catering enquiries and quotes.",
      },
    ],
  },
  {
    group: "Wellness & leisure",
    options: [
      {
        id: "spa",
        label: "Spa / wellness",
        emoji: "💆",
        blurb: "Treatment appointments booked against therapists and rooms.",
      },
      {
        id: "gym",
        label: "Gym / fitness",
        emoji: "🏋️",
        blurb: "Classes and equipment slots guests sign up for.",
      },
      {
        id: "pool",
        label: "Pool / beach",
        emoji: "🏖️",
        blurb: "Loungers, cabanas, and towel and safety checks.",
      },
    ],
  },
  {
    group: "Experiences",
    options: [
      {
        id: "tours",
        label: "Tours / activities",
        emoji: "🥾",
        blurb: "Guided departures with a capacity per time slot.",
      },
      {
        id: "events",
        label: "Events / venue hire",
        emoji: "🎉",
        blurb: "Weddings, conferences, and private hire of your spaces.",
      },
      {
        id: "transport",
        label: "Transport / transfers",
        emoji: "🚐",
        blurb: "Airport runs, shuttles, and driver scheduling.",
      },
    ],
  },
  {
    group: "Other services",
    options: [
      {
        id: "retail",
        label: "Retail / shop",
        emoji: "🛍️",
        blurb: "A shop or boutique selling to guests.",
      },
      {
        id: "laundry",
        label: "Guest laundry",
        emoji: "🧺",
        blurb: "Laundry and dry-cleaning requests with turnaround times.",
      },
      {
        id: "coworking",
        label: "Coworking / meeting rooms",
        emoji: "🖥️",
        blurb: "Desks and meeting rooms booked by the hour.",
      },
    ],
  },
];

const OPERATIONS_OPTIONS: OperationOption[] = OPERATION_GROUPS.flatMap(
  (g) => g.options,
);

// Operations that follow with near-certainty from the property type — used to
// pre-seed the "What do you run" step so we don't ask a restaurant whether it
// runs a restaurant. Deliberately only tautologies: a wrong preselection here
// creates real artifacts downstream (booking services, chatbot actions), so
// anything merely LIKELY (hotel → restaurant, sales dept → events venue) stays
// an unticked chip for the user to confirm.
const OPS_BY_TYPE: Record<string, string[]> = {
  hotel: ["rooms"],
  resort: ["rooms"],
  hostel: ["rooms"],
  restaurant: ["restaurant"],
  "cafe-bar": ["bar", "cafe"],
};

// How guests reach the property — drives chatbot channels + intake forms.
const GUEST_CONTACT_OPTIONS: { id: string; label: string }[] = [
  { id: "walk_in", label: "Walk-in" },
  { id: "phone", label: "Phone" },
  { id: "whatsapp", label: "WhatsApp" },
  { id: "email", label: "Email" },
  { id: "ota", label: "OTAs (Booking.com, Airbnb…)" },
  { id: "website", label: "Website" },
];

type Dept = { name: string; icon: string; color: EntityColor };
type InviteRow = {
  email: string;
  role: "manager" | "staff";
  department?: string;
  /** Pre-fill carried onto the invite (0072): applied to their profile on
   *  accept, editable by them during invited-user onboarding. */
  name?: string;
  title?: string;
};

type Answers = {
  propertyName: string;
  propertyType: string;
  teamSize: string;
  departments: Dept[];
  roleTitle: string;
  priorities: string[];
  operations: string[];
  guestContact: string[];
  invites: InviteRow[];
  /** Optional website — scraped server-side to prefill answers. */
  website: string;
  /** Free-text "how the property runs" — seeded by website enrichment. */
  notes: string;
};

const TOTAL_STEPS = 7;

// ─── Wizard ─────────────────────────────────────────────────────────────────

export function OnboardingWizard({
  fullName,
  addingProperty = false,
  returnTo = null,
}: {
  fullName: string | null;
  addingProperty?: boolean;
  returnTo?: string | null;
}) {
  const router = useRouter();
  const firstName = (fullName ?? "").trim().split(/\s+/)[0] || null;

  const [step, setStep] = useState(0);
  // Priorities + guest channels aren't asked anymore — every property gets
  // the full build (all priorities, all contact channels). The fields stay
  // in Answers so the plan generator and property_profiles keep their shape.
  const [answers, setAnswers] = useState<Answers>({
    propertyName: "",
    propertyType: "",
    teamSize: "",
    departments: [],
    roleTitle: "",
    priorities: [...PRIORITY_OPTIONS],
    operations: [],
    guestContact: GUEST_CONTACT_OPTIONS.map((o) => o.id),
    invites: [],
    website: "",
    notes: "",
  });
  // Website enrichment: fired once per pasted URL when leaving step 1; the
  // result merges ONLY into still-empty answers (a user choice always wins,
  // and results landing mid-wizard never overwrite ticked chips).
  const enrichRequestedFor = useRef<string | null>(null);
  const startEnrichment = (rawUrl: string) => {
    const url = rawUrl.trim();
    if (!url || enrichRequestedFor.current === url) return;
    enrichRequestedFor.current = url;
    void fetch("/api/onboarding/enrich", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    })
      .then(async (res) => {
        if (!res.ok) return;
        const json = (await res.json().catch(() => null)) as {
          enrichment?: {
            summary?: string;
            operations?: string[];
            propertyType?: string | null;
          } | null;
        } | null;
        const e = json?.enrichment;
        if (!e) return;
        const validOps = new Set(OPERATIONS_OPTIONS.map((o) => o.id));
        setAnswers((a) => ({
          ...a,
          propertyType:
            a.propertyType ||
            (e.propertyType &&
            PROPERTY_TYPES.some((t) => t.id === e.propertyType)
              ? e.propertyType
              : ""),
          operations: a.operations.length
            ? a.operations
            : (e.operations ?? []).filter((o) => validOps.has(o)),
          notes: a.notes.trim() ? a.notes : (e.summary ?? "").slice(0, 1000),
        }));
      })
      .catch(() => {
        // Fail-soft: enrichment is purely additive.
      });
  };
  // The property type whose department preset is currently applied — so
  // switching type on step 2 refreshes step 3's defaults, but the user's
  // own edits survive going back and forth without a type change.
  const [presetFor, setPresetFor] = useState<string | null>(null);
  const [opsSeededFor, setOpsSeededFor] = useState<string | null>(null);
  const [deptDraft, setDeptDraft] = useState("");
  // Inline department rename (click a selected chip; X removes it).
  const [renamingDept, setRenamingDept] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  const set = <K extends keyof Answers>(key: K, value: Answers[K]) =>
    setAnswers((a) => ({ ...a, [key]: value }));

  const next = () => setStep((s) => Math.min(s + 1, TOTAL_STEPS - 1));
  const back = () => setStep((s) => Math.max(s - 1, 0));

  // Apply smart department defaults BY TYPE when advancing into step 3 —
  // the user's own edits survive going back unless they change the type.
  const applyDeptPreset = () => {
    if (presetFor === answers.propertyType && answers.departments.length > 0) {
      return;
    }
    const names =
      DEPARTMENT_PRESETS[answers.propertyType] ?? DEPARTMENT_PRESETS.other;
    set(
      "departments",
      names.map((name, i) => ({
        name,
        icon: defaultDeptIcon(name),
        color: colorAt(i),
      })),
    );
    setPresetFor(answers.propertyType);
  };

  // Same contract as applyDeptPreset, for the operations step: seed the chips
  // that are certain from the type + chosen departments when advancing into
  // step 5; the user's own ticks survive going back unless they change type.
  const applyOpsPreset = () => {
    if (opsSeededFor === answers.propertyType && answers.operations.length > 0) {
      return;
    }
    // Union, not replace — website enrichment (and any prior ticks) survive.
    const seeded = new Set([
      ...answers.operations,
      ...(OPS_BY_TYPE[answers.propertyType] ?? []),
    ]);
    // A team that exists is near-proof the operation exists. Keyed off the
    // shared taxonomy so "Wellness", "Spa & Wellness" and "Spa" all count —
    // the old inline regexes only caught some of the spellings the presets
    // and the AI plan actually produce.
    for (const d of answers.departments) {
      switch (departmentFamily(d.name)) {
        case "spa":
          seeded.add("spa");
          break;
        case "bar":
          seeded.add("bar");
          break;
        case "fitness":
          seeded.add("gym");
          break;
        case "pool":
          seeded.add("pool");
          break;
        case "transport":
          seeded.add("transport");
          break;
        case "laundry":
          seeded.add("laundry");
          break;
      }
    }
    set("operations", [...seeded]);
    setOpsSeededFor(answers.propertyType);
  };

  const commitRename = (oldName: string) => {
    const name = renameDraft.trim();
    setRenamingDept(null);
    if (!name || name === oldName) return;
    if (
      answers.departments.some(
        (d) => d.name.toLowerCase() === name.toLowerCase(),
      )
    ) {
      return;
    }
    set(
      "departments",
      answers.departments.map((d) =>
        d.name === oldName ? { ...d, name } : d,
      ),
    );
  };

  // Everything in the preset catalog (all property types) the user hasn't
  // selected — one tap toggles a department on instead of typing it.
  // Deduped by MEANING, not by string. The presets disagree with each other
  // across property types — hotel says "Front Office", hostel says "Front
  // Desk", hotel says "Engineering & Maintenance", hostel says "Maintenance" —
  // so a lowercase-exact filter offered a hotel "Front Desk" as something new
  // to add when it already had Front Office. `departmentFamily` collapses
  // synonyms; genuinely distinct teams (Kitchen vs Bar vs Food & Beverage)
  // keep their own families and stay on offer.
  const deptSuggestions = useMemo(() => {
    const taken = new Set(answers.departments.map((d) => departmentFamily(d.name)));
    const out: string[] = [];
    const preferred = DEPARTMENT_PRESETS[answers.propertyType] ?? [];
    for (const name of [
      ...preferred,
      ...Object.values(DEPARTMENT_PRESETS).flat(),
      ...EXTRA_DEPARTMENT_SUGGESTIONS,
    ]) {
      const family = departmentFamily(name);
      if (taken.has(family)) continue;
      taken.add(family);
      out.push(name);
    }
    return out.slice(0, 12);
  }, [answers.departments, answers.propertyType]);

  const canContinue = useMemo(() => {
    switch (step) {
      case 0:
        return answers.propertyName.trim().length > 0;
      case 1:
        return answers.propertyType !== "" && answers.teamSize !== "";
      case 2:
        return answers.departments.length > 0;
      case 3:
        return true; // role + priorities are nudged, not required
      default:
        return true;
    }
  }, [step, answers]);

  const propertyName = answers.propertyName.trim() || "your property";

  return (
    <div className="flex min-h-svh flex-col bg-guest-bg text-guest-ink">
      {/* Progress bar */}
      <div className="fixed inset-x-0 top-0 z-10 h-1 bg-guest-line-soft">
        <div
          className="h-full w-(--progress) bg-guest-accent transition-[width] duration-500 ease-out"
          style={
            {
              "--progress": `${((step + 1) / TOTAL_STEPS) * 100}%`,
            } as React.CSSProperties
          }
        />
      </div>

      {/* Escape hatch — only when adding an ADDITIONAL property (first-run has
          nowhere to return to, so the user must complete it). */}
      {addingProperty && returnTo && (
        <button
          type="button"
          onClick={() => router.push(returnTo)}
          className="fixed right-5 top-5 z-10 rounded-full px-3 py-1.5 text-sm text-guest-ink-faint transition-colors hover:text-guest-ink"
        >
          Cancel
        </button>
      )}

      {/* `m-auto`, NOT `items-center`. Flex centering overflows a too-tall
          child EQUALLY in both directions, and the part that overflows above
          the container's top edge cannot be scrolled to — the review step
          (step 7) grew past the viewport and its top was unreachable. Auto
          margins center the same way but collapse to zero rather than going
          negative, so a tall step just scrolls. */}
      <main className="flex flex-1 flex-col justify-center px-6 py-16">
        <div
          key={step}
          className="m-auto w-full max-w-xl animate-in fade-in slide-in-from-bottom-2 duration-300"
        >
          {step === 0 && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!canContinue) return;
                startEnrichment(answers.website);
                next();
              }}
            >
              <Eyebrow>
                {firstName ? `Hi ${firstName} · ` : ""}Step 1 of {TOTAL_STEPS}
              </Eyebrow>
              <Question>What&rsquo;s your property called?</Question>
              <GuestHint>
                This becomes your team&rsquo;s workspace. You can rename it any
                time.
              </GuestHint>
              <GuestBigInput
                autoFocus
                value={answers.propertyName}
                onChange={(e) => set("propertyName", e.target.value)}
                placeholder="The Grand Hotel"
                maxLength={120}
                className="mt-10"
              />
              <div className="mt-6">
                <span className="mb-1.5 block text-xs text-guest-ink-faint">
                  Website (optional) — we&rsquo;ll read it and prefill what we
                  can
                </span>
                <GuestInput
                  type="text"
                  inputMode="url"
                  value={answers.website}
                  onChange={(e) => set("website", e.target.value)}
                  placeholder="thegrandhotel.com"
                  maxLength={200}
                  className="w-full max-w-sm"
                />
              </div>
              <div className="mt-10 flex items-center gap-3">
                <PrimaryButton disabled={!canContinue}>Continue</PrimaryButton>
                <span className="text-xs text-guest-ink-faint">
                  press Enter ↵
                </span>
              </div>
            </form>
          )}

          {step === 1 && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!canContinue) return;
                applyDeptPreset();
                next();
              }}
            >
              <Eyebrow>Step 2 of {TOTAL_STEPS}</Eyebrow>
              <Question>What kind of place is {propertyName}?</Question>
              <div className="mt-8 flex flex-wrap gap-2">
                {PROPERTY_TYPES.map((t) => (
                  <Chip
                    key={t.id}
                    selected={answers.propertyType === t.id}
                    onClick={() => set("propertyType", t.id)}
                  >
                    {t.label}
                  </Chip>
                ))}
              </div>
              <Eyebrow className="mt-10 mb-0">
                And how big is the management team?
              </Eyebrow>
              <div className="mt-3 flex flex-wrap gap-2">
                {TEAM_SIZES.map((s) => (
                  <Chip
                    key={s}
                    selected={answers.teamSize === s}
                    onClick={() => set("teamSize", s)}
                  >
                    {s}
                  </Chip>
                ))}
              </div>
              <div className="mt-10 flex items-center gap-3">
                <PrimaryButton disabled={!canContinue}>Continue</PrimaryButton>
                <GhostButton onClick={back}>Back</GhostButton>
              </div>
            </form>
          )}

          {step === 2 && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (canContinue) next();
              }}
            >
              <Eyebrow>Step 3 of {TOTAL_STEPS}</Eyebrow>
              <Question>Which teams run {propertyName}?</Question>
              <GuestHint>
                Each one gets its own space and channel. We&rsquo;ve
                pre-selected the usual suspects — tap to remove, or add your
                own.
              </GuestHint>
              <div className="mt-8 flex flex-wrap gap-2">
                {answers.departments.map((d) =>
                  renamingDept === d.name ? (
                    <GuestInput
                      key={d.name}
                      autoFocus
                      value={renameDraft}
                      onChange={(e) => setRenameDraft(e.target.value)}
                      onBlur={() => commitRename(d.name)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          commitRename(d.name);
                        }
                        if (e.key === "Escape") setRenamingDept(null);
                      }}
                      maxLength={60}
                      className="h-9 w-44"
                    />
                  ) : (
                    <Chip
                      key={d.name}
                      selected
                      title="Click to rename"
                      onClick={() => {
                        setRenamingDept(d.name);
                        setRenameDraft(d.name);
                      }}
                    >
                      <span className="mr-1.5">{d.icon}</span>
                      {d.name}
                      <X
                        className="ml-2 inline size-3.5 opacity-50 hover:opacity-100"
                        aria-hidden
                        onClick={(e) => {
                          e.stopPropagation();
                          set(
                            "departments",
                            answers.departments.filter(
                              (x) => x.name !== d.name,
                            ),
                          );
                        }}
                      />
                    </Chip>
                  ),
                )}
              </div>
              {deptSuggestions.length > 0 ? (
                <div className="mt-4">
                  <p className="mb-2 text-xs text-guest-ink-faint">
                    More to toggle on
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {deptSuggestions.map((name) => (
                      <Chip
                        key={name}
                        selected={false}
                        onClick={() =>
                          set("departments", [
                            ...answers.departments,
                            {
                              name,
                              icon: defaultDeptIcon(name),
                              color: colorAt(answers.departments.length),
                            },
                          ])
                        }
                      >
                        <span className="mr-1.5">{defaultDeptIcon(name)}</span>
                        {name}
                      </Chip>
                    ))}
                  </div>
                </div>
              ) : null}
              <div className="mt-5 flex items-center gap-2">
                <GuestInput
                  value={deptDraft}
                  onChange={(e) => setDeptDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      const name = deptDraft.trim();
                      if (!name) return;
                      // Same family check as the suggestion list: typing
                      // "Reception" when Front Office already exists should
                      // no-op rather than create a duplicate team with its
                      // own space and channel.
                      if (
                        answers.departments.some((d) =>
                          isSameDepartment(d.name, name),
                        ) ||
                        answers.departments.length >= 12
                      ) {
                        setDeptDraft("");
                        return;
                      }
                      set("departments", [
                        ...answers.departments,
                        {
                          name,
                          icon: defaultDeptIcon(name),
                          color: colorAt(answers.departments.length),
                        },
                      ]);
                      setDeptDraft("");
                    }
                  }}
                  placeholder="Add your own…"
                  maxLength={60}
                  className="h-10 flex-1"
                />
                <span className="text-xs text-guest-ink-faint">
                  Enter to add
                </span>
              </div>
              <div className="mt-10 flex items-center gap-3">
                <PrimaryButton disabled={!canContinue}>Continue</PrimaryButton>
                <GhostButton onClick={back}>Back</GhostButton>
              </div>
            </form>
          )}

          {step === 3 && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                applyOpsPreset();
                next();
              }}
            >
              <Eyebrow>Step 4 of {TOTAL_STEPS}</Eyebrow>
              <Question>And what&rsquo;s your role?</Question>
              <GuestBigInput
                autoFocus
                value={answers.roleTitle}
                onChange={(e) => set("roleTitle", e.target.value)}
                placeholder="General Manager"
                maxLength={80}
                className="mt-8"
              />
              <div className="mt-4 flex flex-wrap gap-2">
                {ROLE_SUGGESTIONS.map((r) => (
                  <Chip
                    key={r}
                    selected={answers.roleTitle === r}
                    onClick={() => set("roleTitle", r)}
                    className="px-3 py-1.5 text-xs"
                  >
                    {r}
                  </Chip>
                ))}
              </div>
              <div className="mt-10 flex items-center gap-3">
                <PrimaryButton>Continue</PrimaryButton>
                <GhostButton onClick={back}>Back</GhostButton>
              </div>
            </form>
          )}

          {step === 4 && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                next();
              }}
            >
              <Eyebrow>Step 5 of {TOTAL_STEPS}</Eyebrow>
              <Question>What do you run at {propertyName}?</Question>
              <GuestHint>
                We&rsquo;ve ticked what you&rsquo;ve already told us — add
                anything else. We&rsquo;ll set up booking, ordering, and the
                right forms for each.
              </GuestHint>
              {/* Cards, not chips. A chip can only carry a label, and the
                  label alone ("Rentals") doesn't tell you what ticking it
                  DOES. At 17 options they're grouped, because an
                  undifferentiated wall of seventeen is worse than eight. */}
              <div className="mt-8 space-y-6">
                {OPERATION_GROUPS.map(({ group, options }) => (
                  <div key={group}>
                    <p className="mb-2 text-xs text-guest-ink-faint">{group}</p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {options.map((o) => {
                        const on = answers.operations.includes(o.id);
                        return (
                          <button
                            key={o.id}
                            type="button"
                            role="checkbox"
                            aria-checked={on}
                            onClick={() =>
                              set(
                                "operations",
                                on
                                  ? answers.operations.filter((x) => x !== o.id)
                                  : [...answers.operations, o.id],
                              )
                            }
                            className={cn(
                              "flex items-start gap-2.5 rounded-2xl border p-3 text-left transition-colors",
                              on
                                ? "border-guest-accent bg-guest-accent/10"
                                : "border-guest-line bg-guest-card hover:border-guest-line-strong",
                            )}
                          >
                            <span aria-hidden className="mt-px text-base leading-5">
                              {o.emoji}
                            </span>
                            <span className="min-w-0">
                              <span
                                className={cn(
                                  "block text-sm",
                                  on
                                    ? "text-guest-accent-ink"
                                    : "text-guest-ink",
                                )}
                              >
                                {o.label}
                              </span>
                              <span className="mt-0.5 block text-xs leading-snug text-pretty text-guest-ink-faint">
                                {o.blurb}
                              </span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-10 flex items-center gap-3">
                <PrimaryButton>Continue</PrimaryButton>
                <GhostButton onClick={back}>Back</GhostButton>
              </div>
            </form>
          )}

          {step === 5 && (
            <InviteStep
              propertyName={propertyName}
              departments={answers.departments.map((d) => d.name)}
              invites={answers.invites}
              onChange={(invites) => set("invites", invites)}
              onContinue={next}
              onSkip={() => {
                set("invites", []);
                next();
              }}
              onBack={back}
            />
          )}

          {step === 6 && (
            <BuildStep
              answers={answers}
              onDone={(propertyId) => router.push(`/p/${propertyId}/home`)}
              onBack={back}
            />
          )}
        </div>
      </main>
    </div>
  );
}

// ─── Step 5: invites ────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function InviteStep({
  propertyName,
  departments,
  invites,
  onChange,
  onContinue,
  onSkip,
  onBack,
}: {
  propertyName: string;
  departments: string[];
  invites: InviteRow[];
  onChange: (rows: InviteRow[]) => void;
  onContinue: () => void;
  onSkip: () => void;
  onBack: () => void;
}) {
  const rows: InviteRow[] =
    invites.length > 0 ? invites : [{ email: "", role: "staff" }];

  const update = (i: number, patch: Partial<InviteRow>) => {
    const nextRows = rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r));
    onChange(nextRows);
  };

  const validRows = rows.filter((r) => EMAIL_RE.test(r.email.trim()));
  const hasPartial = rows.some(
    (r) => r.email.trim() !== "" && !EMAIL_RE.test(r.email.trim()),
  );

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (hasPartial) return;
        onChange(
          validRows.map((r) => ({
            email: r.email.trim().toLowerCase(),
            role: r.role,
            name: r.name?.trim() || undefined,
            title: r.title?.trim() || undefined,
            department: r.department,
          })),
        );
        onContinue();
      }}
    >
      <Eyebrow>Step 6 of {TOTAL_STEPS}</Eyebrow>
      <Question>Bring the {propertyName} team along?</Question>
      <GuestHint>You can always invite people later from Settings.</GuestHint>
      <div className="mt-8 space-y-4">
        {rows.map((row, i) => (
          <div
            key={i}
            className="relative rounded-2xl border border-guest-line bg-guest-card/60 p-4 sm:p-5"
          >
            {rows.length > 1 ? (
              <button
                type="button"
                aria-label="Remove"
                onClick={() => onChange(rows.filter((_, idx) => idx !== i))}
                className="absolute right-4 top-4 text-sm text-guest-ink-faint transition-colors hover:text-guest-ink"
              >
                ×
              </button>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <span className="mb-1.5 block text-xs text-guest-ink-faint">
                  Name
                </span>
                <GuestInput
                  value={row.name ?? ""}
                  onChange={(e) => update(i, { name: e.target.value })}
                  placeholder="Alex Rivera"
                  className="w-full"
                />
              </div>
              <div>
                <span className="mb-1.5 block text-xs text-guest-ink-faint">
                  Email
                </span>
                <GuestInput
                  type="email"
                  value={row.email}
                  onChange={(e) => update(i, { email: e.target.value })}
                  placeholder="teammate@example.com"
                  className="w-full"
                />
              </div>
              {/* Team comes BEFORE job title: the team narrows what the title
                  can sensibly be, so asking in the other order makes the
                  title's suggestions arrive too late to help. */}
              {departments.length > 0 ? (
                <div>
                  <span className="mb-1.5 block text-xs text-guest-ink-faint">
                    Team
                  </span>
                  <GuestSelect
                    value={row.department ?? ""}
                    onChange={(e) =>
                      update(i, { department: e.target.value || undefined })
                    }
                    aria-label="Team"
                  >
                    {/* Not "No team yet" — for a GM or an owner this IS the
                        answer, not a blank. See LEADERSHIP_TITLES. */}
                    <option value="">Property-wide (no single team)</option>
                    {departments.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </GuestSelect>
                </div>
              ) : null}
              <div>
                <span className="mb-1.5 block text-xs text-guest-ink-faint">
                  Job title
                </span>
                <GuestInput
                  list={`invite-titles-${i}`}
                  value={row.title ?? ""}
                  onChange={(e) => update(i, { title: e.target.value })}
                  placeholder={titlesForDepartment(row.department)[0]}
                  className="w-full"
                />
                {/* Per-row datalist: the options depend on this row's team, so
                    a single shared list would offer chefs to receptionists. */}
                <datalist id={`invite-titles-${i}`}>
                  {titlesForDepartment(row.department).map((t) => (
                    <option key={t} value={t} />
                  ))}
                </datalist>
              </div>
            </div>

            <div className="mt-3">
              <span className="mb-1.5 block text-xs text-guest-ink-faint">
                Access
              </span>
              <div className="inline-flex h-11 items-center rounded-full border border-guest-line bg-guest-card p-1">
                {(["manager", "staff"] as const).map((role) => (
                  <button
                    key={role}
                    type="button"
                    onClick={() => update(i, { role })}
                    className={cn(
                      "rounded-full px-4 py-1.5 text-xs capitalize transition-colors",
                      row.role === role
                        ? "bg-guest-accent/10 text-guest-accent-ink"
                        : "text-guest-ink-faint hover:text-guest-ink",
                    )}
                  >
                    {role}
                  </button>
                ))}
              </div>
            </div>
            <p className="mt-3 text-xs text-guest-ink-faint">
              {row.role === "manager"
                ? "Managers can change settings, automations, and see reports."
                : "Staff can chat, work on tasks, and fill forms — no admin settings."}
            </p>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={() => onChange([...rows, { email: "", role: "staff" }])}
        disabled={rows.length >= 20}
        className="mt-4 rounded-full border border-dashed border-guest-line px-4 py-2 text-sm text-guest-ink-faint transition-colors hover:border-guest-ink-faint hover:text-guest-ink disabled:opacity-40"
      >
        + Add another person
      </button>
      {hasPartial ? (
        <GuestError className="mt-3">
          One of those emails doesn&rsquo;t look right.
        </GuestError>
      ) : null}
      <div className="mt-10 flex items-center gap-3">
        <PrimaryButton disabled={hasPartial}>
          {validRows.length > 0
            ? `Invite ${validRows.length} & finish`
            : "Continue"}
        </PrimaryButton>
        <GhostButton onClick={onSkip}>Skip for now</GhostButton>
        <GhostButton onClick={onBack}>Back</GhostButton>
      </div>
    </form>
  );
}

// ─── Step 6: build ──────────────────────────────────────────────────────────

type BuildPhase = "planning" | "review" | "building" | "done" | "error";

// ─── Review cards ───────────────────────────────────────────────────────────
// The review gate groups the plan into explanatory sub-cards so the user
// understands WHAT each artifact is, not just that it exists. Item lists and
// on/off notes mirror the seeding conditions in actions.ts — keep in sync.

type ReviewGroup = {
  icon: string;
  title: string;
  blurb: string;
  items: { text: string; note?: string }[];
};

function planGroups(plan: OnboardingPlan | null, answers: Answers): ReviewGroup[] {
  if (!plan) return [];
  const propertyName = answers.propertyName.trim() || "your property";
  const groups: ReviewGroup[] = [];

  const extraSlugs = plan.extraChannels
    .filter((c) => c.slug !== "general")
    .map((c) => `#${c.slug}`);
  groups.push({
    icon: "🏡",
    title: "Teams & chat",
    blurb:
      "Each team gets its own space for tasks and a chat channel; #general holds everyone.",
    items: [
      ...plan.spaces.map((s) => ({ text: `${s.icon} ${s.name}` })),
      {
        text: ["#general", ...extraSlugs].join("  ·  "),
        note: "shared channels",
      },
    ],
  });

  if (plan.forms.length > 0) {
    groups.push({
      icon: "📋",
      title: "Forms",
      blurb:
        "Published and ready to use — share them in chat, by link, or pin them to a team.",
      items: plan.forms.map((f) => ({ text: `${f.icon ?? "📋"} ${f.title}` })),
    });
  }

  if (plan.docs.length > 0) {
    groups.push({
      icon: "📚",
      title: "SOPs & playbooks",
      blurb: `Docs marked “written for you” arrive with full starter content adapted to ${propertyName} — edit anything.`,
      items: plan.docs.map((d) => ({
        text: `${d.icon ?? "📄"} ${d.title}`,
        note: d.templateId ? "written for you" : "titled, ready to fill",
      })),
    });
  }

  const bookingSvcs = starterBookingServices(answers.operations);
  const autoItems: ReviewGroup["items"] = [];
  if (plan.forms.some((f) => /maintenance/i.test(f.title))) {
    autoItems.push({
      text: "🔧 Maintenance form submissions become tasks",
      note: "on",
    });
  }
  autoItems.push({
    text: "🙋 Chatbot escalations become high-priority tasks",
    note: "on",
  });
  if (bookingSvcs.length > 0) {
    autoItems.push({
      text: "✅ Auto-confirm small bookings (parties of 4 or fewer)",
      note: "off until you enable it",
    });
  }
  if (answers.priorities.includes("Task tracking")) {
    autoItems.push({
      text: "🚧 Blocked tasks get called out in #general",
      note: "on",
    });
  }
  groups.push({
    icon: "⚡",
    title: "Automations",
    blurb:
      "Live under Workflows from day one — every one can be edited or switched off.",
    items: autoItems,
  });

  if (bookingSvcs.length > 0) {
    groups.push({
      icon: "🗓️",
      title: "Bookable services",
      blurb:
        "Starter services with sensible hours — refine them and go public when you're ready.",
      items: bookingSvcs.map((s) => ({ text: `${s.emoji} ${s.name}` })),
    });
  }

  groups.push({
    icon: "💬",
    title: "Guest chatbot",
    blurb:
      "A draft guest-facing bot tailored to your operations appears under Chatbots shortly after you land — review it before sharing.",
    items: [],
  });

  return groups;
}

function planChecklist(plan: OnboardingPlan | null, answers: Answers): string[] {
  if (!plan) {
    return [
      `Creating ${answers.departments.length} team spaces…`,
      "Setting up channels…",
      "Adding starter labels…",
    ];
  }
  const lines: string[] = [];
  if (plan.spaces.length > 0) {
    lines.push(`Creating ${plan.spaces.length} team spaces…`);
    const slugs = [
      "general",
      ...plan.spaces.map((s) => s.channelSlug),
      ...plan.extraChannels.filter((c) => c.slug !== "general").map((c) => c.slug),
    ];
    const shown = slugs.slice(0, 4).map((s) => `#${s}`);
    lines.push(
      `${shown.join(", ")}${slugs.length > 4 ? ` +${slugs.length - 4} more` : ""} channels`,
    );
  } else {
    lines.push("Setting up #general…");
  }
  if (plan.labels.length > 0) {
    lines.push(
      `Starter labels — ${plan.labels
        .slice(0, 3)
        .map((l) => l.name)
        .join(", ")}${plan.labels.length > 3 ? "…" : ""}`,
    );
  }
  if (plan.forms.length > 0) {
    lines.push(
      plan.forms.length === 1
        ? `A "${plan.forms[0].title}" form, ready to share`
        : `${plan.forms.length} ready-to-share forms — ${plan.forms
            .map((f) => f.title)
            .join(", ")}`,
    );
  }
  if (plan.docs.length > 0) {
    const written = plan.docs.filter((d) => d.templateId).length;
    lines.push(
      `${plan.docs.length} starter SOP doc${plan.docs.length === 1 ? "" : "s"}${
        written > 0 ? ` (${written} arriving fully written)` : ""
      } — ${plan.docs.map((d) => d.title).join(", ")}`,
    );
  }
  const bookingSvcs = starterBookingServices(answers.operations);
  if (bookingSvcs.length > 0) {
    lines.push(
      `${bookingSvcs.length} bookable service${bookingSvcs.length === 1 ? "" : "s"} — ${bookingSvcs
        .map((s) => s.name)
        .join(", ")}`,
    );
  }
  lines.push(
    "A draft guest chatbot, tailored to how you run things (review under Chatbots)",
  );
  if (plan.forms.some((f) => /maintenance/i.test(f.title))) {
    lines.push(
      "A live automation — maintenance form submissions become tasks automatically",
    );
  }
  lines.push(
    "Starter automations — chatbot escalations become tasks, and more under Workflows",
  );
  lines.push(
    "Default alerts — overdue pile-ups, blocked work, unassigned urgent tasks, at-risk projects",
  );
  if (answers.invites.length > 0) {
    lines.push(
      `Inviting ${answers.invites.length} teammate${answers.invites.length === 1 ? "" : "s"}…`,
    );
  }
  return lines;
}

function BuildStep({
  answers,
  onDone,
  onBack,
}: {
  answers: Answers;
  onDone: (propertyId: string) => void;
  onBack: () => void;
}) {
  const [phase, setPhase] = useState<BuildPhase>("planning");
  const [plan, setPlan] = useState<OnboardingPlan | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [shownCount, setShownCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const ranRef = useRef<number>(-1);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const payload: OnboardingAnswersInput = {
    propertyName: answers.propertyName.trim(),
    propertyType: answers.propertyType,
    teamSize: answers.teamSize,
    departments: answers.departments,
    roleTitle: answers.roleTitle.trim(),
    priorities: answers.priorities,
    operations: answers.operations,
    guestContact: answers.guestContact,
    invites: answers.invites,
    website: answers.website.trim(),
    notes: answers.notes.trim(),
  };

  // Confirm handler — only runs once the user approves the review.
  async function runBuild() {
    setPhase("building");
    setShownCount(0);
    try {
      const result = await createWorkspace({ answers: payload, plan });
      if (!mountedRef.current) return;
      if ("error" in result) {
        setError(result.error);
        setPhase("error");
        return;
      }
      setShownCount(Number.MAX_SAFE_INTEGER);
      setPhase("done");
      setTimeout(() => {
        if (mountedRef.current) onDone(result.propertyId);
      }, 1600);
    } catch {
      if (mountedRef.current) {
        setError("Something went wrong while setting up.");
        setPhase("error");
      }
    }
  }

  // Reveal checklist lines one by one while the workspace builds.
  useEffect(() => {
    if (lines.length === 0 || shownCount >= lines.length) return;
    const t = setTimeout(() => setShownCount((c) => c + 1), 550);
    return () => clearTimeout(t);
  }, [lines, shownCount]);

  useEffect(() => {
    // Guard StrictMode double-mount + power the Retry button via `attempt`.
    // NOTE: don't use a per-effect `cancelled` flag here — StrictMode's first
    // cleanup would flip it before the (single, ranRef-guarded) fetch resolves,
    // stranding the UI on "planning" forever. `mountedRef` reflects the *real*
    // mount state across the StrictMode remount, so it only bails on a true
    // unmount.
    if (ranRef.current === attempt) return;
    ranRef.current = attempt;

    void (async () => {
      setPhase("planning");
      setError(null);
      setShownCount(0);

      // Ask the AI for the plan, then STOP at the review screen — the seeding
      // itself only runs once the user confirms (see runBuild). On any failure
      // the server recomputes the deterministic fallback from `plan: null` at
      // build time.
      let nextPlan: OnboardingPlan | null = null;
      try {
        const res = await fetch("/api/onboarding/plan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (res.ok) {
          const json = await res.json();
          const parsed = PlanSchema.safeParse(json?.plan);
          if (parsed.success) nextPlan = parsed.data;
        }
      } catch {
        // fall through — deterministic fallback covers this at build time
      }
      if (!mountedRef.current) return;

      setPlan(nextPlan);
      setLines(planChecklist(nextPlan, answers));
      setPhase("review");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  const propertyName = answers.propertyName.trim() || "your property";
  const groups = phase === "review" ? planGroups(plan, answers) : [];

  if (phase === "done") {
    return (
      <div className="animate-in fade-in zoom-in-95 text-center duration-500">
        <Eyebrow>All set</Eyebrow>
        <Question className="text-4xl sm:text-5xl">
          Welcome to {propertyName}
        </Question>
        <GuestHint className="mt-4">
          Taking you to your new workspace…
        </GuestHint>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="animate-in fade-in duration-300">
        <Eyebrow>Step 7 of {TOTAL_STEPS}</Eyebrow>
        <Question>That didn&rsquo;t work — let&rsquo;s try again.</Question>
        <GuestError>{error}</GuestError>
        <div className="mt-8 flex items-center gap-3">
          <PrimaryButton type="button" onClick={() => setAttempt((a) => a + 1)}>
            Retry setup
          </PrimaryButton>
          <GhostButton onClick={onBack}>Back to edit answers</GhostButton>
        </div>
      </div>
    );
  }

  // Review gate — the user approves the generated plan before anything is
  // created. Nothing has been seeded yet at this point.
  if (phase === "review") {
    return (
      <div className="animate-in fade-in duration-300">
        <Eyebrow>Step 7 of {TOTAL_STEPS} · Review</Eyebrow>
        <Question>Here&rsquo;s what we&rsquo;ll set up for {propertyName}</Question>
        <GuestHint>
          Nothing&rsquo;s been created yet — have a look, then build it. You can
          reshape any of this later.
        </GuestHint>
        {groups.length > 0 ? (
          <div className="mt-8 grid gap-3 sm:grid-cols-2">
            {groups.map((g) => (
              <div
                key={g.title}
                className="rounded-2xl border border-guest-line bg-guest-card/60 p-4"
              >
                <div className="flex items-center gap-2">
                  <span className="text-base">{g.icon}</span>
                  <span className="text-sm font-medium text-guest-ink">
                    {g.title}
                  </span>
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-guest-ink-faint">
                  {g.blurb}
                </p>
                {g.items.length > 0 ? (
                  <ul role="list" className="mt-3 space-y-1.5">
                    {g.items.map((item) => (
                      <li
                        key={item.text}
                        className="flex items-baseline justify-between gap-3 text-sm text-guest-ink-soft"
                      >
                        <span className="min-w-0">{item.text}</span>
                        {item.note ? (
                          <span className="shrink-0 text-[11px] text-guest-ink-faint">
                            {item.note}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <ul role="list" className="mt-8 space-y-2.5">
            {lines.map((line) => (
              <li key={line} className="flex items-center gap-3 text-sm">
                <Check />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-10 flex items-center gap-3">
          <PrimaryButton type="button" onClick={runBuild}>
            Build my workspace
          </PrimaryButton>
          <GhostButton onClick={onBack}>Back</GhostButton>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Eyebrow>Step 7 of {TOTAL_STEPS}</Eyebrow>
      <Question>Setting up {propertyName}…</Question>
      <GuestHint>
        {phase === "planning"
          ? "Designing your workspace around how you run things…"
          : "Almost there — building it now."}
      </GuestHint>
      <ul role="list" className="mt-10 space-y-3">
        {phase === "planning" ? (
          <li className="flex items-center gap-3 text-sm text-guest-ink-soft">
            <Spinner />
            Thinking through {answers.departments.length} departments and{" "}
            {answers.priorities.length || "your"} priorities…
          </li>
        ) : (
          lines.slice(0, Math.max(shownCount, 1)).map((line, i) => (
            <li
              key={line}
              className="flex items-center gap-3 text-sm animate-in fade-in slide-in-from-bottom-1 duration-300"
            >
              {i < shownCount - 1 || shownCount > lines.length ? (
                <Check />
              ) : (
                <Spinner />
              )}
              <span>{line}</span>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

function Spinner() {
  return (
    <span className="inline-block size-4 shrink-0 animate-spin rounded-full border-2 border-guest-line border-t-guest-accent" />
  );
}

function Check() {
  return (
    <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-guest-accent text-[10px] text-white">
      ✓
    </span>
  );
}

