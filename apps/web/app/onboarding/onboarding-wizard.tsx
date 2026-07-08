"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { EntityColor } from "@/lib/db/types";
import {
  PlanSchema,
  colorAt,
  defaultDeptIcon,
  type OnboardingAnswersInput,
  type OnboardingPlan,
} from "@/lib/onboarding/plan";
import { createWorkspace } from "./actions";

/**
 * The setup wizard — a full-screen, one-question-per-screen takeover in
 * its own warm-cream visual world (deliberately not the app shell's
 * palette). Six beats: name → type/size → departments → role/priorities →
 * invites → build. The build screen fetches the AI plan, animates it
 * assembling, runs `createWorkspace`, and lands the user in their new
 * workspace with everything already set up.
 */

// ─── Palette (forced locally — the wizard is its own world) ─────────────────

const ACCENT = "#c96442";
const INK = "#1f1e1b";
const INK_SOFT = "#6f6a60";

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

type Dept = { name: string; icon: string; color: EntityColor };
type InviteRow = { email: string; role: "manager" | "staff" };

type Answers = {
  propertyName: string;
  propertyType: string;
  teamSize: string;
  departments: Dept[];
  roleTitle: string;
  priorities: string[];
  invites: InviteRow[];
};

const TOTAL_STEPS = 6;

// ─── Shared bits ────────────────────────────────────────────────────────────

function Chip({
  selected,
  onClick,
  children,
  className,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "rounded-full border px-4 py-2 text-sm transition-colors duration-150",
        selected
          ? "border-[#c96442] bg-[#c96442]/10 text-[#9d4a2f]"
          : "border-[#dedbd2] bg-white/60 text-[#494539] hover:border-[#bcb6a8]",
        className,
      )}
    >
      {children}
    </button>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-3 text-xs font-medium uppercase tracking-[0.18em] text-[#a39e93]">
      {children}
    </p>
  );
}

function Question({ children }: { children: React.ReactNode }) {
  return (
    <h1 className="font-serif text-3xl leading-tight text-balance sm:text-4xl">
      {children}
    </h1>
  );
}

function PrimaryButton({
  children,
  disabled,
  type = "submit",
  onClick,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  type?: "submit" | "button";
  onClick?: () => void;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "h-11 rounded-full px-7 text-sm font-medium text-white",
        "bg-[#c96442] hover:bg-[#b05236]",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#c96442]",
        "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-[#c96442]",
      )}
    >
      {children}
    </button>
  );
}

function GhostButton({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="h-11 rounded-full px-4 text-sm text-[#8d877b] transition-colors hover:text-[#1f1e1b]"
    >
      {children}
    </button>
  );
}

const bigInputClass =
  "w-full border-0 border-b-2 border-[#dedbd2] bg-transparent pb-2 font-serif text-2xl outline-none transition-colors placeholder:text-[#c5c0b4] focus:border-[#c96442] sm:text-3xl";

// ─── Wizard ─────────────────────────────────────────────────────────────────

export function OnboardingWizard({ fullName }: { fullName: string | null }) {
  const router = useRouter();
  const firstName = (fullName ?? "").trim().split(/\s+/)[0] || null;

  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Answers>({
    propertyName: "",
    propertyType: "",
    teamSize: "",
    departments: [],
    roleTitle: "",
    priorities: [],
    invites: [],
  });
  // The property type whose department preset is currently applied — so
  // switching type on step 2 refreshes step 3's defaults, but the user's
  // own edits survive going back and forth without a type change.
  const [presetFor, setPresetFor] = useState<string | null>(null);
  const [deptDraft, setDeptDraft] = useState("");

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
    <div
      className="flex min-h-svh flex-col"
      style={{ backgroundColor: "#faf9f5", color: INK }}
    >
      {/* Progress bar */}
      <div className="fixed inset-x-0 top-0 z-10 h-1 bg-[#eceae2]">
        <div
          className="h-full transition-[width] duration-500 ease-out"
          style={{
            width: `${((step + 1) / TOTAL_STEPS) * 100}%`,
            backgroundColor: ACCENT,
          }}
        />
      </div>

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
              <p className="mt-3 text-sm" style={{ color: INK_SOFT }}>
                This becomes your team&rsquo;s workspace. You can rename it any
                time.
              </p>
              <input
                autoFocus
                value={answers.propertyName}
                onChange={(e) => set("propertyName", e.target.value)}
                placeholder="The Grand Hotel"
                maxLength={120}
                className={cn(bigInputClass, "mt-10")}
              />
              <div className="mt-10 flex items-center gap-3">
                <PrimaryButton disabled={!canContinue}>Continue</PrimaryButton>
                <span className="text-xs" style={{ color: "#a39e93" }}>
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
              <p
                className="mt-10 text-xs font-medium uppercase tracking-[0.18em]"
                style={{ color: "#a39e93" }}
              >
                And how big is the team?
              </p>
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
              <p className="mt-3 text-sm" style={{ color: INK_SOFT }}>
                Each one gets its own space and channel. We&rsquo;ve
                pre-selected the usual suspects — tap to remove, or add your
                own.
              </p>
              <div className="mt-8 flex flex-wrap gap-2">
                {answers.departments.map((d) => (
                  <Chip
                    key={d.name}
                    selected
                    onClick={() =>
                      set(
                        "departments",
                        answers.departments.filter((x) => x.name !== d.name),
                      )
                    }
                  >
                    <span className="mr-1.5">{d.icon}</span>
                    {d.name}
                    <X className="ml-2 inline size-3.5 opacity-50" aria-hidden />
                  </Chip>
                ))}
              </div>
              <div className="mt-5 flex items-center gap-2">
                <input
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
                  className="h-10 flex-1 rounded-full border border-[#dedbd2] bg-white/60 px-4 text-sm outline-none transition-colors placeholder:text-[#c5c0b4] focus:border-[#c96442]"
                />
                <span className="text-xs" style={{ color: "#a39e93" }}>
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
              <input
                autoFocus
                value={answers.roleTitle}
                onChange={(e) => set("roleTitle", e.target.value)}
                placeholder="General Manager"
                maxLength={80}
                className={cn(bigInputClass, "mt-8")}
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
              <p
                className="mt-10 text-xs font-medium uppercase tracking-[0.18em]"
                style={{ color: "#a39e93" }}
              >
                What should {propertyName} get out of Hotelclaw?
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {PRIORITY_OPTIONS.map((p) => (
                  <Chip
                    key={p}
                    selected={answers.priorities.includes(p)}
                    onClick={() =>
                      set(
                        "priorities",
                        answers.priorities.includes(p)
                          ? answers.priorities.filter((x) => x !== p)
                          : [...answers.priorities, p],
                      )
                    }
                  >
                    {p}
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
            <InviteStep
              propertyName={propertyName}
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

          {step === 5 && (
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
  invites,
  onChange,
  onContinue,
  onSkip,
  onBack,
}: {
  propertyName: string;
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
          validRows.map((r) => ({ email: r.email.trim().toLowerCase(), role: r.role })),
        );
        onContinue();
      }}
    >
      <Eyebrow>Step 5 of {TOTAL_STEPS}</Eyebrow>
      <Question>Bring the {propertyName} team along?</Question>
      <p className="mt-3 text-sm" style={{ color: INK_SOFT }}>
        You can always invite people later from Settings.
      </p>
      <div className="mt-8 space-y-3">
        {rows.map((row, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              type="email"
              value={row.email}
              onChange={(e) => update(i, { email: e.target.value })}
              placeholder="teammate@example.com"
              className="h-11 flex-1 rounded-full border border-[#dedbd2] bg-white/60 px-4 text-sm outline-none transition-colors placeholder:text-[#c5c0b4] focus:border-[#c96442]"
            />
            <div className="flex rounded-full border border-[#dedbd2] bg-white/60 p-0.5">
              {(["manager", "staff"] as const).map((role) => (
                <button
                  key={role}
                  type="button"
                  onClick={() => update(i, { role })}
                  className={cn(
                    "rounded-full px-3 py-1.5 text-xs capitalize transition-colors",
                    row.role === role
                      ? "bg-[#c96442]/10 text-[#9d4a2f]"
                      : "text-[#8d877b] hover:text-[#1f1e1b]",
                  )}
                >
                  {role}
                </button>
              ))}
            </div>
            {rows.length > 1 ? (
              <button
                type="button"
                aria-label="Remove"
                onClick={() => onChange(rows.filter((_, idx) => idx !== i))}
                className="text-sm text-[#a39e93] hover:text-[#1f1e1b]"
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
        className="mt-3 text-sm transition-colors hover:text-[#1f1e1b] disabled:opacity-40"
        style={{ color: "#8d877b" }}
      >
        Add another
      </button>
      {hasPartial ? (
        <p className="mt-3 text-sm text-[#b3422a]">
          One of those emails doesn&rsquo;t look right.
        </p>
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

type BuildPhase = "planning" | "building" | "done" | "error";

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
  if (plan.starterForm) {
    lines.push(`A "${plan.starterForm.title}" form, ready to share`);
  }
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
  const [lines, setLines] = useState<string[]>([]);
  const [shownCount, setShownCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const ranRef = useRef<number>(-1);

  // Reveal checklist lines one by one while the workspace builds.
  useEffect(() => {
    if (lines.length === 0 || shownCount >= lines.length) return;
    const t = setTimeout(() => setShownCount((c) => c + 1), 550);
    return () => clearTimeout(t);
  }, [lines, shownCount]);

  useEffect(() => {
    // Guard StrictMode double-mount + power the Retry button via `attempt`.
    if (ranRef.current === attempt) return;
    ranRef.current = attempt;

    let cancelled = false;

    (async () => {
      setPhase("planning");
      setError(null);
      setShownCount(0);

      const payload: OnboardingAnswersInput = {
        propertyName: answers.propertyName.trim(),
        propertyType: answers.propertyType,
        teamSize: answers.teamSize,
        departments: answers.departments,
        roleTitle: answers.roleTitle.trim(),
        priorities: answers.priorities,
        invites: answers.invites,
      };

      // 1. Ask the AI for the plan. On any failure the server action
      //    recomputes the deterministic fallback from `plan: null`.
      let plan: OnboardingPlan | null = null;
      try {
        const res = await fetch("/api/onboarding/plan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (res.ok) {
          const json = await res.json();
          const parsed = PlanSchema.safeParse(json?.plan);
          if (parsed.success) plan = parsed.data;
        }
      } catch {
        // fall through — server-side fallback covers this
      }
      if (cancelled) return;

      setLines(planChecklist(plan, answers));
      setPhase("building");

      // 2. Seed the workspace.
      try {
        const result = await createWorkspace({ answers: payload, plan });
        if (cancelled) return;
        if ("error" in result) {
          setError(result.error);
          setPhase("error");
          return;
        }
        // Let the checklist finish its reveal, then the payoff beat.
        setShownCount(Number.MAX_SAFE_INTEGER);
        setPhase("done");
        setTimeout(() => {
          if (!cancelled) onDone(result.propertyId);
        }, 1600);
      } catch {
        if (!cancelled) {
          setError("Something went wrong while setting up.");
          setPhase("error");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  const propertyName = answers.propertyName.trim() || "your property";

  if (phase === "done") {
    return (
      <div className="animate-in fade-in zoom-in-95 text-center duration-500">
        <Eyebrow>All set</Eyebrow>
        <h1 className="font-serif text-4xl leading-tight text-balance sm:text-5xl">
          Welcome to {propertyName}
        </h1>
        <p className="mt-4 text-sm" style={{ color: INK_SOFT }}>
          Taking you to your new workspace…
        </p>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="animate-in fade-in duration-300">
        <Eyebrow>Step 6 of {TOTAL_STEPS}</Eyebrow>
        <Question>That didn&rsquo;t work — let&rsquo;s try again.</Question>
        <p className="mt-4 text-sm text-[#b3422a]">{error}</p>
        <div className="mt-8 flex items-center gap-3">
          <PrimaryButton type="button" onClick={() => setAttempt((a) => a + 1)}>
            Retry setup
          </PrimaryButton>
          <GhostButton onClick={onBack}>Back to edit answers</GhostButton>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Eyebrow>Step 6 of {TOTAL_STEPS}</Eyebrow>
      <Question>Setting up {propertyName}…</Question>
      <p className="mt-3 text-sm" style={{ color: INK_SOFT }}>
        {phase === "planning"
          ? "Designing your workspace around how you run things…"
          : "Almost there — building it now."}
      </p>
      <ul className="mt-10 space-y-3">
        {phase === "planning" ? (
          <li className="flex items-center gap-3 text-sm" style={{ color: INK_SOFT }}>
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
    <span
      className="inline-block size-4 shrink-0 animate-spin rounded-full border-2 border-[#dedbd2]"
      style={{ borderTopColor: ACCENT }}
    />
  );
}

function Check() {
  return (
    <span
      className="flex size-4 shrink-0 items-center justify-center rounded-full text-[10px] text-white"
      style={{ backgroundColor: ACCENT }}
    >
      ✓
    </span>
  );
}

