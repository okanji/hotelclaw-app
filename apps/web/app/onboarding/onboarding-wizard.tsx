"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  BedDouble,
  Check as CheckIcon,
  CircleCheck,
  Coffee,
  Hotel,
  Plus,
  Sparkles,
  TreePalm,
  UtensilsCrossed,
  X,
  type LucideIcon,
} from "lucide-react";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { Gi } from "@/components/gr8r/icon";
import {
  AuthAlert,
  AuthCardMark,
  AuthShell,
  FieldErr,
} from "@/components/auth/auth-shell";
import {
  departmentFamily,
  isSameDepartment,
  titlesForDepartment,
} from "@/lib/onboarding/taxonomy";
import {
  DEPARTMENT_FOR_OPERATION,
  OPERATIONS_OPTIONS,
  OPERATION_GROUPS,
} from "@/lib/onboarding/operations";
import type { EntityColor } from "@/lib/db/types";
import {
  PlanSchema,
  colorAt,
  defaultDeptIcon,
  type OnboardingAnswersInput,
  type OnboardingPlan,
} from "@/lib/onboarding/plan";
import { createWorkspace } from "./actions";
import { ReviewPlan, buildReviewSections } from "./review-plan";

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

// gr8r-studio's onboarding (src/pages/auth.js `renderOnboarding`): the auth
// frame, one `.auth-card.onb` per step with the `.steps` progress ticks,
// single-choice `.opt` cards, `.seg` for short scales, and a Back / Continue
// `.row` at the bottom. Multi-select chip rows (teams, role suggestions) are
// `.onb-pick` buttons (gr8r-ext.css) — gr8r's wizard has no multi-select.

/** A toggle chip: btn-secondary btn-sm, `.on` = gr8r's `.opt.on` look. */
function Pick({
  selected,
  className,
  ...props
}: React.ComponentProps<"button"> & { selected: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={`btn btn-secondary btn-sm onb-pick${selected ? " on" : ""}${className ? ` ${className}` : ""}`}
      {...props}
    />
  );
}

/** gr8r's `nav()` — Back (ghost) left, extra actions + Continue right. */
function StepNav({
  onBack,
  extra,
  next = "Continue",
  disabled,
}: {
  onBack?: () => void;
  extra?: React.ReactNode;
  next?: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <div className="row" style={{ marginTop: 6 }}>
      {onBack ? (
        <button type="button" className="btn btn-ghost" onClick={onBack}>
          <Gi icon={ArrowLeft} size={14} />
          Back
        </button>
      ) : null}
      <span className="sp" />
      {extra}
      <button type="submit" className="btn btn-primary btn-lg" disabled={disabled}>
        {next}
        <Gi icon={ArrowRight} size={15} />
      </button>
    </div>
  );
}

const FORM_STYLE: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 16,
};

// ─── Step data ──────────────────────────────────────────────────────────────

const PROPERTY_TYPES: readonly {
  id: string;
  label: string;
  blurb: string;
  icon: LucideIcon;
}[] = [
  { id: "hotel", label: "Hotel", blurb: "Rooms & guest services", icon: Hotel },
  { id: "resort", label: "Resort", blurb: "Stays, dining & leisure", icon: TreePalm },
  { id: "hostel", label: "Hostel", blurb: "Beds & shared spaces", icon: BedDouble },
  { id: "restaurant", label: "Restaurant", blurb: "Tables & kitchen", icon: UtensilsCrossed },
  { id: "cafe-bar", label: "Café or bar", blurb: "Counter, bar & kitchen", icon: Coffee },
  { id: "other", label: "Other", blurb: "Something else", icon: Sparkles },
];

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

// Operations catalog (ids, labels, blurbs, groups) lives in
// lib/onboarding/operations.ts — shared with the website-enrichment route so
// its whitelist can't drift behind this list again.

// Operations that follow with near-certainty from the property type — used to
// pre-seed the "What do you run" step so we don't ask a restaurant whether it
// runs a restaurant. Deliberately only tautologies: a wrong preselection here
// creates real artifacts downstream (chatbot actions, forms), so
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

/**
 * Is this typed-so-far string worth spending a scrape on? Users paste bare
 * domains ("pinewood.co.ke") as often as full URLs, so we can't lean on URL
 * parsing. Requires a dotted host with a 2+ char TLD and no spaces — enough
 * to skip the half-typed states a debounce would otherwise fire on.
 */
function looksLikeDomain(raw: string): boolean {
  const value = raw.trim().replace(/^https?:\/\//i, "");
  if (!value || /\s/.test(value)) return false;
  const host = value.split(/[/?#]/)[0];
  return /^([a-z0-9-]+\.)+[a-z]{2,}$/i.test(host);
}

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
  // Website enrichment.
  //
  // TIMING: fired as soon as the URL looks like a domain (debounced while
  // typing, and on blur), not on Continue. The scrape + model round-trip takes
  // a few seconds, and the answers it prefills live two to four steps later —
  // starting at submit meant the result often landed after the user had
  // already answered the questions it was meant to fill in. Starting at entry
  // buys those seconds back. The submit path still calls it as a backstop for
  // the paste-and-immediately-Enter case; `enrichRequestedFor` dedupes all
  // three entry points to one request per URL.
  //
  // MERGE: only into still-EMPTY answers. A user choice always wins, so a
  // result landing mid-wizard can never overwrite a chip they've ticked.
  const enrichRequestedFor = useRef<string | null>(null);
  const [enrichState, setEnrichState] = useState<
    "idle" | "loading" | "done" | "empty"
  >("idle");
  // Teams the website evidenced. Kept OUT of `answers.departments` until the
  // preset runs, because `applyDeptPreset` replaces that list wholesale when
  // the property type is chosen — writing straight into it would lose the
  // enriched teams whenever the result landed before step 3.
  const [enrichedDepartments, setEnrichedDepartments] = useState<string[]>([]);
  const startEnrichment = (rawUrl: string) => {
    const url = rawUrl.trim();
    if (!url || enrichRequestedFor.current === url) return;
    enrichRequestedFor.current = url;
    setEnrichState("loading");
    void fetch("/api/onboarding/enrich", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    })
      .then(async (res) => {
        // Discard a stale response. Someone typing slowly can pause on a
        // valid-looking prefix ("pinewood.co" is a real TLD), firing a request
        // for a URL they didn't mean; the real one fires on the next keystroke
        // but may resolve FIRST, letting the wrong answer land last and win.
        if (enrichRequestedFor.current !== url) return;
        if (!res.ok) {
          setEnrichState("empty");
          return;
        }
        const json = (await res.json().catch(() => null)) as {
          enrichment?: {
            summary?: string;
            operations?: string[];
            propertyType?: string | null;
          } | null;
        } | null;
        const e = json?.enrichment;
        if (!e) {
          setEnrichState("empty");
          return;
        }
        const validOps = new Set(OPERATIONS_OPTIONS.map((o) => o.id));
        const ops = (e.operations ?? []).filter((o) => validOps.has(o));
        // A spa page on the website is good evidence of a spa TEAM, not just a
        // spa service — carry the implication through to step 3.
        setEnrichedDepartments(
          ops
            .map((o) => DEPARTMENT_FOR_OPERATION[o])
            .filter((d): d is string => Boolean(d)),
        );
        setAnswers((a) => ({
          ...a,
          propertyType:
            a.propertyType ||
            (e.propertyType &&
            PROPERTY_TYPES.some((t) => t.id === e.propertyType)
              ? e.propertyType
              : ""),
          operations: a.operations.length ? a.operations : ops,
          notes: a.notes.trim() ? a.notes : (e.summary ?? "").slice(0, 1000),
        }));
        setEnrichState(
          ops.length > 0 || e.propertyType || e.summary ? "done" : "empty",
        );
      })
      .catch(() => {
        // Fail-soft: enrichment is purely additive.
        if (enrichRequestedFor.current === url) setEnrichState("empty");
      });
  };
  // Kick enrichment off while they're still on step 1. The guard matters: a
  // debounce alone would fire on "pinewood.c" and burn the one-shot dedupe on
  // a URL that can't resolve, so we wait for something shaped like a domain.
  const debouncedWebsite = useDebouncedValue(answers.website, 900);
  useEffect(() => {
    if (looksLikeDomain(debouncedWebsite)) startEnrichment(debouncedWebsite);
  }, [debouncedWebsite]);

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
    // Type preset, widened by whatever the website evidenced. Deduped by
    // taxonomy FAMILY so an enriched "Restaurant" doesn't sit next to the
    // hotel preset's "Food & Beverage" as a second, near-identical team.
    const names = [
      ...(DEPARTMENT_PRESETS[answers.propertyType] ?? DEPARTMENT_PRESETS.other),
    ];
    for (const extra of enrichedDepartments) {
      if (!names.some((n) => isSameDepartment(n, extra))) names.push(extra);
    }
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
  const removeDept = (name: string) =>
    set(
      "departments",
      answers.departments.filter((x) => x.name !== name),
    );

  return (
    <AuthShell
      topRight={
        // Escape hatch — only when adding an ADDITIONAL property (first-run
        // has nowhere to return to, so the user must complete it).
        addingProperty && returnTo ? (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => router.push(returnTo)}
          >
            Exit setup
          </button>
        ) : null
      }
    >
      <div
        key={step}
        className="auth-card onb fx-step"
        // Every step but the last asks ONE question in gr8r's 560px card.
        // The review is an inventory of ~40 artifacts, so it gets the width
        // to lay them out two-up instead of one long ribbon.
        style={{ maxWidth: step === TOTAL_STEPS - 1 ? 760 : 560 }}
      >
        <div
          className="steps"
          aria-label={`Step ${step + 1} of ${TOTAL_STEPS}`}
        >
          {Array.from({ length: TOTAL_STEPS }, (_, i) => (
            <i
              key={i}
              className={
                [i <= step ? "on" : "", i === step ? "cur" : ""]
                  .filter(Boolean)
                  .join(" ") || undefined
              }
            />
          ))}
        </div>
        <div className="faint" style={{ textAlign: "center", fontSize: 12 }}>
          {firstName && step === 0 ? `Hi ${firstName} · ` : ""}Step {step + 1}{" "}
          of {TOTAL_STEPS}
        </div>

        {step === 0 && (
          <form
            style={FORM_STYLE}
            onSubmit={(e) => {
              e.preventDefault();
              if (!canContinue) return;
              startEnrichment(answers.website);
              next();
            }}
          >
            <h1>What&rsquo;s your property called?</h1>
            <p className="sub">
              This becomes your team&rsquo;s workspace. You can rename it any
              time.
            </p>
            <div className="field">
              <label className="label" htmlFor="o-name">
                Property name
              </label>
              <input
                id="o-name"
                className="input input-lg"
                autoFocus
                value={answers.propertyName}
                onChange={(e) => set("propertyName", e.target.value)}
                placeholder="The Grand Hotel"
                maxLength={120}
              />
            </div>
            <div className="field">
              <label className="label" htmlFor="o-website">
                Website <span className="faint">(optional)</span>
              </label>
              <input
                id="o-website"
                className="input input-lg"
                type="text"
                inputMode="url"
                value={answers.website}
                onChange={(e) => set("website", e.target.value)}
                // Blur beats the debounce when they tab straight out.
                onBlur={() => startEnrichment(answers.website)}
                placeholder="thegrandhotel.com"
                maxLength={200}
              />
              {/* Say what's happening. Answers quietly appearing two steps
                  later reads as a glitch unless the reading was visible. */}
              {enrichState === "idle" ? (
                <span className="hint">
                  We&rsquo;ll read it and prefill what we can.
                </span>
              ) : (
                <span
                  aria-live="polite"
                  className="hint"
                  style={
                    enrichState === "done"
                      ? {
                          color: "var(--g8-green)",
                          display: "flex",
                          gap: 4,
                          alignItems: "center",
                        }
                      : undefined
                  }
                >
                  {enrichState === "done" ? (
                    <Gi icon={CheckIcon} size={12} />
                  ) : null}
                  {enrichState === "loading"
                    ? "Reading your site…"
                    : enrichState === "done"
                      ? "Read your site — we've prefilled what we could."
                      : "Couldn't read that site. No problem — carry on."}
                </span>
              )}
            </div>
            <StepNav disabled={!canContinue} />
          </form>
        )}

        {step === 1 && (
          <form
            style={FORM_STYLE}
            onSubmit={(e) => {
              e.preventDefault();
              if (!canContinue) return;
              applyDeptPreset();
              next();
            }}
          >
            <h1>What kind of place is {propertyName}?</h1>
            <p className="sub">
              We&rsquo;ll tailor teams, channels and starter docs to fit.
            </p>
            <div className="opts" role="radiogroup" aria-label="Property type">
              {PROPERTY_TYPES.map((t) => {
                const on = answers.propertyType === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    className={on ? "opt on" : "opt"}
                    onClick={() => set("propertyType", t.id)}
                  >
                    <Gi icon={t.icon} size={18} />
                    <b>{t.label}</b>
                    <span>{t.blurb}</span>
                  </button>
                );
              })}
            </div>
            <div className="field">
              <span className="label">
                And how big is the management team?
              </span>
              <div
                className="seg"
                role="radiogroup"
                aria-label="Team size"
                style={{ width: "fit-content", maxWidth: "100%", flexWrap: "wrap" }}
              >
                {TEAM_SIZES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    role="radio"
                    aria-checked={answers.teamSize === s}
                    className={answers.teamSize === s ? "on" : undefined}
                    onClick={() => set("teamSize", s)}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
            <StepNav onBack={back} disabled={!canContinue} />
          </form>
        )}

        {step === 2 && (
          <form
            style={FORM_STYLE}
            onSubmit={(e) => {
              e.preventDefault();
              if (canContinue) next();
            }}
          >
            <h1>Which teams run {propertyName}?</h1>
            <p className="sub">
              Each one gets its own space and channel. We&rsquo;ve
              pre-selected the usual suspects — click one to rename it, × to
              remove, or add your own.
            </p>
            <div className="onb-picks">
              {answers.departments.map((d) =>
                renamingDept === d.name ? (
                  <input
                    key={d.name}
                    className="input"
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
                    aria-label={`Rename ${d.name}`}
                    style={{ width: 176, height: "var(--g8-h-sm)" }}
                  />
                ) : (
                  <span
                    key={d.name}
                    className="btn btn-secondary btn-sm onb-pick on"
                    style={{ paddingRight: 3, gap: 4 }}
                  >
                    <button
                      type="button"
                      title="Click to rename"
                      className="row"
                      style={{ gap: 6 }}
                      onClick={() => {
                        setRenamingDept(d.name);
                        setRenameDraft(d.name);
                      }}
                    >
                      <span aria-hidden>{d.icon}</span>
                      {d.name}
                    </button>
                    <button
                      type="button"
                      className="ibtn ibtn-xs"
                      aria-label={`Remove ${d.name}`}
                      onClick={() => removeDept(d.name)}
                    >
                      <Gi icon={X} size={12} />
                    </button>
                  </span>
                ),
              )}
            </div>
            {deptSuggestions.length > 0 ? (
              <div className="field">
                <span className="label">More to toggle on</span>
                <div className="onb-picks">
                  {deptSuggestions.map((name) => (
                    <Pick
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
                      <span aria-hidden>{defaultDeptIcon(name)}</span>
                      {name}
                    </Pick>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="field">
              <label className="label" htmlFor="o-dept">
                Add your own
              </label>
              <input
                id="o-dept"
                className="input"
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
                placeholder="e.g. Security"
                maxLength={60}
              />
              <span className="hint">Press Enter to add.</span>
            </div>
            <StepNav onBack={back} disabled={!canContinue} />
          </form>
        )}

        {step === 3 && (
          <form
            style={FORM_STYLE}
            onSubmit={(e) => {
              e.preventDefault();
              applyOpsPreset();
              next();
            }}
          >
            <h1>And what&rsquo;s your role?</h1>
            <p className="sub">
              So the assistant and your reports speak to the right person.
            </p>
            <div className="field">
              <label className="label" htmlFor="o-role">
                Your role
              </label>
              <input
                id="o-role"
                className="input input-lg"
                autoFocus
                value={answers.roleTitle}
                onChange={(e) => set("roleTitle", e.target.value)}
                placeholder="General Manager"
                maxLength={80}
              />
            </div>
            <div className="onb-picks">
              {ROLE_SUGGESTIONS.map((r) => (
                <Pick
                  key={r}
                  selected={answers.roleTitle === r}
                  onClick={() => set("roleTitle", r)}
                >
                  {r}
                </Pick>
              ))}
            </div>
            <StepNav onBack={back} />
          </form>
        )}

        {step === 4 && (
          <form
            style={FORM_STYLE}
            onSubmit={(e) => {
              e.preventDefault();
              next();
            }}
          >
            <h1>What do you run at {propertyName}?</h1>
            <p className="sub">
              We&rsquo;ve ticked what you&rsquo;ve already told us — add
              anything else. We&rsquo;ll set up ordering and the
              right forms for each.
            </p>
            {/* gr8r `.opt` cards, not chips: the label alone ("Rentals")
                doesn't tell you what ticking it DOES. Grouped, because an
                undifferentiated wall of seventeen is worse than eight. */}
            {OPERATION_GROUPS.map(({ group, options }) => (
              <div key={group} className="field">
                <span className="label">{group}</span>
                <div className="opts two">
                  {options.map((o) => {
                    const on = answers.operations.includes(o.id);
                    return (
                      <button
                        key={o.id}
                        type="button"
                        role="checkbox"
                        aria-checked={on}
                        className={on ? "opt on" : "opt"}
                        onClick={() =>
                          set(
                            "operations",
                            on
                              ? answers.operations.filter((x) => x !== o.id)
                              : [...answers.operations, o.id],
                          )
                        }
                      >
                        <span aria-hidden className="em">
                          {o.emoji}
                        </span>
                        <b>{o.label}</b>
                        <span>{o.blurb}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            <StepNav onBack={back} />
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
    </AuthShell>
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
      style={FORM_STYLE}
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
      <h1>Bring the {propertyName} team along?</h1>
      <p className="sub">
        They&rsquo;ll get an email invite. You can always invite people later
        from Members.
      </p>
      <div className="col" style={{ gap: 10 }}>
        {rows.map((row, i) => (
          <div
            key={i}
            className="panel"
            style={{ padding: 14, display: "flex", flexDirection: "column", gap: 12 }}
          >
            <div className="row">
              <span className="label" style={{ margin: 0 }}>
                Teammate {i + 1}
              </span>
              <span className="sp" />
              {rows.length > 1 ? (
                <button
                  type="button"
                  className="ibtn ibtn-sm"
                  aria-label={`Remove teammate ${i + 1}`}
                  onClick={() => onChange(rows.filter((_, idx) => idx !== i))}
                >
                  <Gi icon={X} size={14} />
                </button>
              ) : null}
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                gap: 12,
              }}
            >
              <div className="field">
                <label className="label" htmlFor={`inv-name-${i}`}>
                  Name
                </label>
                <input
                  id={`inv-name-${i}`}
                  className="input"
                  value={row.name ?? ""}
                  onChange={(e) => update(i, { name: e.target.value })}
                  placeholder="Alex Rivera"
                />
              </div>
              <div className="field">
                <label className="label" htmlFor={`inv-email-${i}`}>
                  Email
                </label>
                <input
                  id={`inv-email-${i}`}
                  className={
                    row.email.trim() !== "" && !EMAIL_RE.test(row.email.trim())
                      ? "input is-error"
                      : "input"
                  }
                  type="email"
                  value={row.email}
                  onChange={(e) => update(i, { email: e.target.value })}
                  placeholder="teammate@example.com"
                />
              </div>
              {/* Team comes BEFORE job title: the team narrows what the title
                  can sensibly be, so asking in the other order makes the
                  title's suggestions arrive too late to help. */}
              {departments.length > 0 ? (
                <div className="field">
                  <label className="label" htmlFor={`inv-team-${i}`}>
                    Team
                  </label>
                  <select
                    id={`inv-team-${i}`}
                    className="select"
                    value={row.department ?? ""}
                    onChange={(e) =>
                      update(i, { department: e.target.value || undefined })
                    }
                  >
                    {/* Not "No team yet" — for a GM or an owner this IS the
                        answer, not a blank. See LEADERSHIP_TITLES. */}
                    <option value="">Property-wide (no single team)</option>
                    {departments.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
              <div className="field">
                <label className="label" htmlFor={`inv-title-${i}`}>
                  Job title
                </label>
                <input
                  id={`inv-title-${i}`}
                  className="input"
                  list={`invite-titles-${i}`}
                  value={row.title ?? ""}
                  onChange={(e) => update(i, { title: e.target.value })}
                  placeholder={titlesForDepartment(row.department)[0]}
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
            <div className="field">
              <span className="label">Access</span>
              <div
                className="seg"
                role="radiogroup"
                aria-label="Access"
                style={{ width: "fit-content" }}
              >
                {(["manager", "staff"] as const).map((role) => (
                  <button
                    key={role}
                    type="button"
                    role="radio"
                    aria-checked={row.role === role}
                    className={row.role === role ? "on" : undefined}
                    style={{ textTransform: "capitalize" }}
                    onClick={() => update(i, { role })}
                  >
                    {role}
                  </button>
                ))}
              </div>
              <span className="hint">
                {row.role === "manager"
                  ? "Managers can change settings, automations, and see reports."
                  : "Staff can chat, work on tasks, and fill forms — no admin settings."}
              </span>
            </div>
          </div>
        ))}
      </div>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        style={{ alignSelf: "flex-start" }}
        onClick={() => onChange([...rows, { email: "", role: "staff" }])}
        disabled={rows.length >= 20}
      >
        <Gi icon={Plus} size={13} />
        Add another person
      </button>
      {hasPartial ? (
        <FieldErr>One of those emails doesn&rsquo;t look right.</FieldErr>
      ) : null}
      <StepNav
        onBack={onBack}
        disabled={hasPartial}
        extra={
          <button type="button" className="btn btn-ghost" onClick={onSkip}>
            Skip for now
          </button>
        }
        next={
          validRows.length > 0
            ? `Invite ${validRows.length} & finish`
            : "Continue"
        }
      />
    </form>
  );
}

// ─── Step 6: build ──────────────────────────────────────────────────────────

type BuildPhase = "planning" | "review" | "building" | "done" | "error";

// Review-gate UI + its data model live in ./review-plan.tsx.

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
  // Derived from the answers when the AI plan is null, so a plan failure
  // thins this screen out rather than collapsing it to a bare checklist.
  const review =
    phase === "review"
      ? buildReviewSections(plan, answers)
      : { sections: [], summary: [] };

  if (phase === "done") {
    // gr8r's "Your workspace is ready" beat.
    return (
      <>
        <AuthCardMark
          icon={CircleCheck}
          size={48}
          color="var(--g8-green)"
          className="ready-badge"
        />
        <h1>Welcome to {propertyName}</h1>
        <p className="sub">Taking you to your new workspace…</p>
      </>
    );
  }

  if (phase === "error") {
    return (
      <>
        <h1>That didn&rsquo;t work — let&rsquo;s try again.</h1>
        {error ? <AuthAlert>{error}</AuthAlert> : null}
        <div className="row" style={{ marginTop: 6 }}>
          <button type="button" className="btn btn-ghost" onClick={onBack}>
            <Gi icon={ArrowLeft} size={14} />
            Back to edit answers
          </button>
          <span className="sp" />
          <button
            type="button"
            className="btn btn-primary btn-lg"
            onClick={() => setAttempt((a) => a + 1)}
          >
            Retry setup
          </button>
        </div>
      </>
    );
  }

  // Review gate — the user approves the generated plan before anything is
  // created. Nothing has been seeded yet at this point.
  if (phase === "review") {
    return (
      <>
        <h1>Here&rsquo;s what we&rsquo;ll set up for {propertyName}</h1>
        <p className="sub">
          Nothing&rsquo;s been created yet — have a look, then build it. You can
          reshape any of this later.
        </p>
        <ReviewPlan sections={review.sections} summary={review.summary} />
        <div className="row" style={{ marginTop: 6 }}>
          <button type="button" className="btn btn-ghost" onClick={onBack}>
            <Gi icon={ArrowLeft} size={14} />
            Back
          </button>
          <span className="sp" />
          <button
            type="button"
            className="btn btn-primary btn-lg"
            onClick={runBuild}
          >
            Build my workspace
            <Gi icon={ArrowRight} size={15} />
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <h1>Setting up {propertyName}…</h1>
      <p className="sub">
        {phase === "planning"
          ? "Designing your workspace around how you run things…"
          : "Almost there — building it now."}
      </p>
      {/* gr8r's "ready" panel: one `.ready-row` per artifact, ticking in. */}
      <ul role="list" className="panel" style={{ margin: 0, padding: 0 }}>
        {phase === "planning" ? (
          <BuildRow done={false}>
            Thinking through {answers.departments.length} departments and{" "}
            {answers.priorities.length || "your"} priorities…
          </BuildRow>
        ) : (
          lines
            .slice(0, Math.max(shownCount, 1))
            .map((line, i) => (
              <BuildRow
                key={line}
                first={i === 0}
                done={i < shownCount - 1 || shownCount > lines.length}
              >
                {line}
              </BuildRow>
            ))
        )}
      </ul>
    </>
  );
}

function BuildRow({
  done,
  first = true,
  children,
}: {
  done: boolean;
  first?: boolean;
  children: React.ReactNode;
}) {
  return (
    <li
      className="row ready-row"
      style={{
        listStyle: "none",
        padding: "12px 14px",
        gap: 12,
        borderTop: first ? undefined : "1px solid var(--g8-divider)",
      }}
    >
      <span className="grow" style={{ minWidth: 0 }}>
        {children}
      </span>
      {done ? (
        <span
          className="ok"
          style={{ color: "var(--g8-green)", display: "inline-flex" }}
        >
          <Gi icon={CheckIcon} size={15} />
        </span>
      ) : (
        <Spinner />
      )}
    </li>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden
      className="inline-block size-3.5 shrink-0 animate-spin rounded-full border-2"
      style={{
        borderColor: "var(--g8-border-strong)",
        borderTopColor: "var(--g8-accent)",
      }}
    />
  );
}
