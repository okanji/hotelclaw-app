"use client";

import {
  BookOpen,
  ClipboardList,
  Hash,
  MessageCircle,
  Tag,
  Users,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { Gi } from "@/components/gr8r/icon";
import {
  slugifyChannel,
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
  // Chatbot before automations, deliberately. Both are "what runs on its own"
  // rather than "what gets created", but the chatbot is a half-width card and
  // automations is full-width — leading with the narrow one lets it pair off
  // with the card before it instead of stranding a hole in the mosaic, and
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
      {/* The shape of the build at a glance — gr8r's `.stats` strip. */}
      {summary.length > 0 ? (
        <dl
          className="stats"
          style={{
            gridTemplateColumns: `repeat(${Math.min(summary.length, 4)}, minmax(0, 1fr))`,
            margin: 0,
          }}
        >
          {summary.map((s) => (
            <div key={s.label} className="stat">
              <dd className="v" style={{ margin: 0 }}>
                {s.value}
              </dd>
              <dt className="k">{s.label}</dt>
            </div>
          ))}
        </dl>
      ) : null}

      {/* Auto-fit, not breakpoints: the grid lives inside the wizard card,
          so viewport width says nothing about the space it actually has. */}
      <dl
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: 10,
          margin: 0,
        }}
      >
        {sections.map((section) => (
          <SectionCard key={section.key} section={section} />
        ))}
      </dl>
    </>
  );
}

function SectionCard({ section }: { section: ReviewSection }) {
  const { Icon, title, count, blurb, items, layout = "rows", wide } = section;
  return (
    // Cards earn their keep here: each section is a fundamentally different
    // content type — gr8r's `.panel` with a `.panel-h` header.
    <div className="panel" style={wide ? { gridColumn: "1 / -1" } : undefined}>
      <dt className="panel-h">
        <Gi icon={Icon} size={15} className="faint" />
        <h2>{title}</h2>
        {count !== undefined ? (
          <span className="faint" style={{ fontVariantNumeric: "tabular-nums" }}>
            {count}
          </span>
        ) : null}
      </dt>
      <dd className="panel-b" style={{ margin: 0 }}>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          {blurb}
        </p>
        {items.length === 0 ? null : layout === "pills" ? (
          <ul role="list" className="onb-picks" style={{ margin: "10px 0 0", padding: 0 }}>
            {items.map((item) => (
              <li key={item.label} className="badge gray">
                {item.emoji ? <span aria-hidden>{item.emoji}</span> : null}
                {item.label}
              </li>
            ))}
          </ul>
        ) : layout === "tags" ? (
          <ul
            role="list"
            className="row"
            style={{ flexWrap: "wrap", gap: "4px 12px", margin: "10px 0 0", padding: 0 }}
          >
            {items.map((item) => (
              <li key={item.label} className="muted" style={{ fontSize: 13, listStyle: "none" }}>
                {item.label}
              </li>
            ))}
          </ul>
        ) : (
          // Rows, shaped like the record they'll become — the same emoji +
          // title + qualifier the user will meet again in Docs or Workflows.
          <ul role="list" className="panel" style={{ margin: "10px 0 0", padding: 0 }}>
            {items.map((item, i) => (
              <li
                key={item.label}
                className="row"
                style={{
                  listStyle: "none",
                  padding: "8px 10px",
                  gap: 10,
                  borderTop: i ? "1px solid var(--g8-divider)" : undefined,
                }}
              >
                {item.emoji ? (
                  <span aria-hidden style={{ flexShrink: 0 }}>
                    {item.emoji}
                  </span>
                ) : null}
                <span className="grow" style={{ minWidth: 0, fontSize: 13 }}>
                  {item.label}
                </span>
                {item.note ? (
                  item.highlight ? (
                    <span className="badge accent">{item.note}</span>
                  ) : (
                    <span className="faint" style={{ fontSize: 12, flexShrink: 0 }}>
                      {item.note}
                    </span>
                  )
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </dd>
    </div>
  );
}
