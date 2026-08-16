"use client";

import {
  BookOpen,
  CalendarCheck,
  ClipboardList,
  Hash,
  MessageCircle,
  Tag,
  Users,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  slugifyChannel,
  starterBookingServices,
  type OnboardingPlan,
} from "@/lib/onboarding/plan";

/**
 * The review gate — the last screen before we create ~40 real artifacts in
 * someone's workspace.
 *
 * Its job is not to list what happens; it is to make the user willing to press
 * the button. So it shows the artifacts THEMSELVES — the actual team names and
 * their icons, the actual SOP titles, which of them arrive fully written —
 * rather than counting them in prose. A row that reads "6 starter SOP docs —
 * Shift Handover Playbook, Emergency & Incident Procedures, …" is a sentence
 * you skim; the same six as document rows is an inventory you check.
 *
 * The layout mirrors where each artifact will actually live once built (team
 * chips, document rows, channel tags), so the screen doubles as a preview of
 * the workspace rather than a receipt for it.
 *
 * **Works without a plan.** `buildReviewSections` derives everything it can
 * from the wizard answers alone, so an AI-plan failure degrades to a thinner
 * version of this same screen instead of collapsing to a bare checklist.
 */

type ReviewItem = {
  /** The record's OWN icon, chosen by the user or the plan — data, not
   *  decoration, and the same glyph they'll see in the app. */
  emoji?: string;
  label: string;
  /** Right-aligned qualifier: "Written for you", "On", "Off for now". */
  note?: string;
  /** Draw the note as an accent badge rather than quiet text. */
  highlight?: boolean;
};

type ReviewSection = {
  key: string;
  Icon: LucideIcon;
  title: string;
  /** Shown beside the title; omitted when a count would be meaningless. */
  count?: number;
  blurb: string;
  items: ReviewItem[];
  /** Rendered as compact pills instead of full rows — for short labels. */
  layout?: "rows" | "pills" | "tags";
  /** Spans both columns. */
  wide?: boolean;
};

/* -------------------------------------------------------------------------- */
/* Data                                                                       */
/* -------------------------------------------------------------------------- */

export function buildReviewSections(
  plan: OnboardingPlan | null,
  answers: {
    propertyName: string;
    departments: { name: string; icon: string }[];
    operations: string[];
    priorities: string[];
    invites: { email: string }[];
  },
): { sections: ReviewSection[]; summary: { label: string; value: number }[] } {
  const propertyName = answers.propertyName.trim() || "your property";

  // Teams: the plan's spaces when we have them, else the answers' own chips.
  const teams = plan?.spaces.length
    ? plan.spaces.map((s) => ({ name: s.name, emoji: s.icon, slug: s.channelSlug }))
    : answers.departments.map((d) => ({
        name: d.name,
        emoji: d.icon,
        slug: slugifyChannel(d.name),
      }));

  const channels = [
    "general",
    ...teams.map((t) => t.slug),
    ...(plan?.extraChannels ?? [])
      .filter((c) => c.slug !== "general")
      .map((c) => c.slug),
  ].filter((slug, i, all) => all.indexOf(slug) === i);

  const services = starterBookingServices(answers.operations);
  const sections: ReviewSection[] = [];

  if (teams.length > 0) {
    sections.push({
      key: "teams",
      Icon: Users,
      title: "Teams",
      count: teams.length,
      blurb: "Each one gets a space for its tasks and its own chat channel.",
      items: teams.map((t) => ({ emoji: t.emoji, label: t.name })),
      layout: "pills",
    });
  }

  sections.push({
    key: "channels",
    Icon: Hash,
    title: "Channels",
    count: channels.length,
    blurb: "#general holds everyone; the rest are scoped to a team or a topic.",
    items: channels.map((slug) => ({ label: `#${slug}` })),
    layout: "tags",
  });

  if (plan?.docs.length) {
    const written = plan.docs.filter((d) => d.templateId).length;
    sections.push({
      key: "docs",
      Icon: BookOpen,
      title: "SOPs & playbooks",
      count: plan.docs.length,
      blurb: written
        ? `${written} arrive already written for ${propertyName} — open and edit anything.`
        : "Titled and ready for you to fill in.",
      items: plan.docs.map((d) => ({
        emoji: d.icon ?? "📄",
        label: d.title,
        note: d.templateId ? "Written for you" : "Ready to fill",
        highlight: Boolean(d.templateId),
      })),
      wide: true,
    });
  }

  if (plan?.forms.length) {
    sections.push({
      key: "forms",
      Icon: ClipboardList,
      title: "Forms",
      count: plan.forms.length,
      blurb: "Published and shareable — by link, in chat, or pinned to a team.",
      items: plan.forms.map((f) => ({
        emoji: f.icon ?? "📋",
        label: f.title,
        note: `${f.fields.length} question${f.fields.length === 1 ? "" : "s"}`,
      })),
    });
  }

  if (plan?.labels.length) {
    sections.push({
      key: "labels",
      Icon: Tag,
      title: "Labels",
      count: plan.labels.length,
      blurb: "For sorting tasks the moment work starts coming in.",
      items: plan.labels.map((l) => ({ label: l.name })),
      layout: "tags",
    });
  }

  if (services.length > 0) {
    sections.push({
      key: "bookings",
      Icon: CalendarCheck,
      title: "Bookable services",
      count: services.length,
      blurb: "Starter hours you can refine before going public.",
      items: services.map((s) => ({ emoji: s.emoji, label: s.name })),
    });
  }

  // Automations mirror the seeding conditions in actions.ts — keep in sync.
  const automations: ReviewItem[] = [];
  if (plan?.forms.some((f) => /maintenance/i.test(f.title))) {
    automations.push({
      emoji: "🔧",
      label: "Maintenance submissions become tasks",
      note: "On",
      highlight: true,
    });
  }
  automations.push({
    emoji: "🙋",
    label: "Chatbot escalations become high-priority tasks",
    note: "On",
    highlight: true,
  });
  if (answers.priorities.includes("Task tracking")) {
    automations.push({
      emoji: "🚧",
      label: "Blocked tasks get called out in #general",
      note: "On",
      highlight: true,
    });
  }
  if (services.length > 0) {
    automations.push({
      emoji: "✅",
      label: "Auto-confirm bookings for parties of 4 or fewer",
      note: "Off for now",
    });
  }
  // Chatbot before automations, deliberately. Both are "what runs on its own"
  // rather than "what gets created", but the chatbot is a half-width card and
  // automations is full-width — leading with the narrow one lets it pair off
  // with Bookable services instead of stranding a hole in the mosaic, and
  // leaves the full-width automations list as the closing statement.
  sections.push({
    key: "chatbot",
    Icon: MessageCircle,
    title: "Guest chatbot",
    blurb: `A draft bot that answers guest questions the way ${propertyName} runs. It lands under Chatbots for you to review before anyone sees it.`,
    items: [],
  });

  sections.push({
    key: "automations",
    Icon: Zap,
    title: "Automations",
    count: automations.length,
    blurb: "Live under Workflows from day one — edit or switch off any of them.",
    items: automations,
    wide: true,
  });

  const summary = [
    { label: teams.length === 1 ? "Team" : "Teams", value: teams.length },
    { label: "Channels", value: channels.length },
    { label: "Documents", value: plan?.docs.length ?? 0 },
    { label: "Forms", value: plan?.forms.length ?? 0 },
    { label: "Services", value: services.length },
    { label: "Automations", value: automations.length },
  ].filter((s) => s.value > 0);

  return { sections, summary };
}

/* -------------------------------------------------------------------------- */
/* UI                                                                         */
/* -------------------------------------------------------------------------- */

export function ReviewPlan({
  sections,
  summary,
}: {
  sections: ReviewSection[];
  summary: { label: string; value: number }[];
}) {
  return (
    <>
      {/* The shape of the build at a glance, before any detail. Stats carry
          their own contrast (big number / small label), so they need no card
          or divider — whitespace is the lightest separation that works. */}
      {summary.length > 0 ? (
        <dl className="mt-8 flex flex-wrap gap-x-8 gap-y-3">
          {summary.map((s) => (
            <div key={s.label}>
              <dd className="text-2xl tabular-nums text-guest-ink">{s.value}</dd>
              <dt className="text-sm text-guest-ink-faint">{s.label}</dt>
            </div>
          ))}
        </dl>
      ) : null}

      {/* `@container`, not viewport breakpoints — this grid lives inside the
          wizard's fixed 36rem column, so viewport width tells us nothing
          useful about the space it actually has. */}
      <div className="@container mt-8">
        <dl className="grid gap-3 @2xl:grid-cols-2">
          {sections.map((section) => (
            <SectionCard key={section.key} section={section} />
          ))}
        </dl>
      </div>
    </>
  );
}

function SectionCard({ section }: { section: ReviewSection }) {
  const { Icon, title, count, blurb, items, layout = "rows", wide } = section;
  return (
    // Cards earn their keep here: each section is a fundamentally different
    // content type, not a sibling metric. Radii are concentric — the 12px
    // inner rows sit inside a 16px card with 16px padding.
    <div
      className={cn(
        "rounded-2xl border border-guest-line bg-guest-card/60 p-4",
        wide && "@2xl:col-span-2",
      )}
    >
      <dt className="flex items-center gap-2">
        <Icon className="size-4 shrink-0 stroke-guest-ink-faint" aria-hidden />
        <span className="text-base font-medium text-guest-ink sm:text-sm">
          {title}
        </span>
        {count !== undefined ? (
          <span className="text-base tabular-nums text-guest-ink-faint sm:text-sm">
            {count}
          </span>
        ) : null}
      </dt>
      <dd>
        <p className="mt-1 text-base text-pretty text-guest-ink-faint sm:text-sm">
          {blurb}
        </p>
        {items.length === 0 ? null : layout === "pills" ? (
          <ul role="list" className="mt-3 flex flex-wrap gap-1.5">
            {items.map((item) => (
              <li
                key={item.label}
                className="flex items-center gap-1.5 rounded-full border border-guest-line bg-guest-bg px-2.5 py-1 text-base text-guest-ink sm:text-sm"
              >
                {item.emoji ? <span aria-hidden>{item.emoji}</span> : null}
                {item.label}
              </li>
            ))}
          </ul>
        ) : layout === "tags" ? (
          <ul role="list" className="mt-3 flex flex-wrap gap-x-3 gap-y-1">
            {items.map((item) => (
              <li
                key={item.label}
                className="text-base text-guest-ink-soft sm:text-sm"
              >
                {item.label}
              </li>
            ))}
          </ul>
        ) : (
          // Rows, shaped like the record they'll become — the same emoji +
          // title + qualifier the user will meet again in Docs or Workflows.
          <ul role="list" className="mt-3 flex flex-col gap-1">
            {items.map((item) => (
              <li
                key={item.label}
                className="flex items-center gap-2.5 rounded-xl border border-guest-line bg-guest-bg px-2.5 py-2"
              >
                {item.emoji ? (
                  <span aria-hidden className="shrink-0">
                    {item.emoji}
                  </span>
                ) : null}
                <span className="min-w-0 flex-1 text-base text-pretty text-guest-ink sm:text-sm">
                  {item.label}
                </span>
                {item.note ? (
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-xs",
                      item.highlight
                        ? "bg-guest-accent/10 text-guest-accent-ink"
                        : "text-guest-ink-faint",
                    )}
                  >
                    {item.note}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </dd>
    </div>
  );
}
