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
} from "@/components/guest/ui";
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
  { id: "boutique-hotel", label: "Boutique hotel" },
  { id: "full-service-hotel", label: "Full-service hotel" },
  { id: "resort", label: "Resort" },
  { id: "hostel", label: "Hostel" },
  { id: "restaurant", label: "Restaurant" },
  { id: "cafe-bar", label: "Café or bar" },
  { id: "other", label: "Other" },
] as const;

const TEAM_SIZES = ["Just me", "2–10", "11–50", "51–200", "200+"] as const;

const DEPARTMENT_PRESETS: Record<string, string[]> = {
  "boutique-hotel": [
    "Front Office",
    "Housekeeping",
    "Food & Beverage",
    "Engineering & Maintenance",
    "Sales & Events",
  ],
  "full-service-hotel": [
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

const ROLE_SUGGESTIONS = [
  "General Manager",
  "Operations Manager",
  "Owner",
  "Front Office Manager",
  "F&B Manager",
  "Head Housekeeper",
];

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

// What the property runs on-site — drives bookings services, chatbot, and
// operation-specific forms in the build plan.
const OPERATIONS_OPTIONS: { id: string; label: string }[] = [
  { id: "rooms", label: "Rooms / stays" },
  { id: "restaurant", label: "Restaurant" },
  { id: "bar", label: "Bar" },
  { id: "spa", label: "Spa / wellness" },
  { id: "events", label: "Events / venue" },
  { id: "tours", label: "Tours / activities" },
  { id: "rentals", label: "Rentals" },
  { id: "retail", label: "Retail / shop" },
];

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
type InviteRow = { email: string; role: "manager" | "staff"; department?: string };

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
  });
  // The property type whose department preset is currently applied — so
  // switching type on step 2 refreshes step 3's defaults, but the user's
  // own edits survive going back and forth without a type change.
  const [presetFor, setPresetFor] = useState<string | null>(null);
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
  const deptSuggestions = useMemo(() => {
    const selected = new Set(
      answers.departments.map((d) => d.name.toLowerCase()),
    );
    const seen = new Set<string>();
    const out: string[] = [];
    const preferred = DEPARTMENT_PRESETS[answers.propertyType] ?? [];
    for (const name of [...preferred, ...Object.values(DEPARTMENT_PRESETS).flat()]) {
      const key = name.toLowerCase();
      if (seen.has(key) || selected.has(key)) continue;
      seen.add(key);
      out.push(name);
    }
    return out.slice(0, 10);
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

      <main className="flex flex-1 items-center justify-center px-6 py-16">
        <div
          key={step}
          className="w-full max-w-xl animate-in fade-in slide-in-from-bottom-2 duration-300"
        >
          {step === 0 && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (canContinue) next();
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
                And how big is the team?
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
                      if (
                        answers.departments.some(
                          (d) => d.name.toLowerCase() === name.toLowerCase(),
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
                Pick everything that applies — we&rsquo;ll set up booking,
                ordering, and the right forms for each.
              </GuestHint>
              <div className="mt-8 flex flex-wrap gap-2">
                {OPERATIONS_OPTIONS.map((o) => (
                  <Chip
                    key={o.id}
                    selected={answers.operations.includes(o.id)}
                    onClick={() =>
                      set(
                        "operations",
                        answers.operations.includes(o.id)
                          ? answers.operations.filter((x) => x !== o.id)
                          : [...answers.operations, o.id],
                      )
                    }
                  >
                    {o.label}
                  </Chip>
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
            department: r.department,
          })),
        );
        onContinue();
      }}
    >
      <Eyebrow>Step 6 of {TOTAL_STEPS}</Eyebrow>
      <Question>Bring the {propertyName} team along?</Question>
      <GuestHint>You can always invite people later from Settings.</GuestHint>
      <div className="mt-8 space-y-3">
        {rows.map((row, i) => (
          <div key={i} className="flex items-center gap-2">
            <GuestInput
              type="email"
              value={row.email}
              onChange={(e) => update(i, { email: e.target.value })}
              placeholder="teammate@example.com"
              className="flex-1"
            />
            <div className="flex rounded-full border border-guest-line bg-guest-card p-0.5">
              {(["manager", "staff"] as const).map((role) => (
                <button
                  key={role}
                  type="button"
                  onClick={() => update(i, { role })}
                  className={cn(
                    "rounded-full px-3 py-1.5 text-xs capitalize transition-colors",
                    row.role === role
                      ? "bg-guest-accent/10 text-guest-accent-ink"
                      : "text-guest-ink-faint hover:text-guest-ink",
                  )}
                >
                  {role}
                </button>
              ))}
            </div>
            {departments.length > 0 ? (
              <select
                value={row.department ?? ""}
                onChange={(e) =>
                  update(i, { department: e.target.value || undefined })
                }
                aria-label="Team"
                className="h-9 max-w-36 truncate rounded-full border border-guest-line bg-guest-card px-3 text-xs text-guest-ink outline-none"
              >
                <option value="">No team yet</option>
                {departments.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            ) : null}
            {rows.length > 1 ? (
              <button
                type="button"
                aria-label="Remove"
                onClick={() => onChange(rows.filter((_, idx) => idx !== i))}
                className="text-sm text-guest-ink-faint hover:text-guest-ink"
              >
                ×
              </button>
            ) : null}
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={() => onChange([...rows, { email: "", role: "staff" }])}
        disabled={rows.length >= 20}
        className="mt-3 text-sm text-guest-ink-faint transition-colors hover:text-guest-ink disabled:opacity-40"
      >
        Add another
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
    lines.push(
      `${plan.docs.length} starter SOP doc${plan.docs.length === 1 ? "" : "s"} — ${plan.docs
        .map((d) => d.title)
        .join(", ")}`,
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
        <ul role="list" className="mt-8 space-y-2.5">
          {lines.map((line) => (
            <li key={line} className="flex items-center gap-3 text-sm">
              <Check />
              <span>{line}</span>
            </li>
          ))}
        </ul>
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

