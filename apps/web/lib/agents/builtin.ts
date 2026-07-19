/**
 * Descriptors for the app's built-in AI — the transparency half of the
 * Agents section. Custom agents are rows in `agents`; these are the
 * code-defined bots that ship with the product, listed read-only so staff
 * can see every AI that acts inside their property and what it can touch.
 *
 * Keep entries honest: `where` is the surface the bot lives on, `tools`
 * names what it can actually read/do, `promptSummary` describes the persona
 * in one or two sentences (the full personas live in lib/ai/bots/*).
 */
export type BuiltinAgentInfo = {
  id: string;
  name: string;
  emoji: string;
  where: string;
  description: string;
  promptSummary: string;
  tools: string[];
  model: string;
};

export const BUILTIN_AGENTS: BuiltinAgentInfo[] = [
  {
    id: "channel-bot",
    name: "Channel bot",
    emoji: "💬",
    where: "Team chat channels",
    description: "Answers @hotelclaw mentions and (in auto mode) questions it can help with.",
    promptSummary:
      "Property-aware chat assistant. Answers from live property data and can render rich cards (tables, stats, links) inline in the channel.",
    tools: [
      "List open tasks",
      "Search documents",
      "List upcoming meetings",
      "Org chart",
      "Render rich UI",
      "Shared brain (gbrain)",
    ],
    model: "Sonnet",
  },
  {
    id: "task-bot",
    name: "Task assistant",
    emoji: "✅",
    where: "Task detail panel",
    description: "Q&A about a single task, its subtasks and related work.",
    promptSummary:
      "Scoped to the open task: explains status, finds related tasks, suggests next steps. Read-only.",
    tools: ["Task details", "Subtasks", "Related tasks", "Shared brain (gbrain)"],
    model: "Sonnet",
  },
  {
    id: "doc-bot",
    name: "Document assistant",
    emoji: "📄",
    where: "Document editor",
    description: "Q&A over the open document plus inline writing help.",
    promptSummary:
      "Answers questions about the open document and can propose new content blocks; edits are always applied by the human.",
    tools: ["Read document", "Propose content", "Shared brain (gbrain)"],
    model: "Sonnet",
  },
  {
    id: "insights-bot",
    name: "Insights writers",
    emoji: "📈",
    where: "Insights section",
    description: "Weekly reports, the intelligence brief, and risk annotations.",
    promptSummary:
      "Writes narrative over deterministic metrics — it never computes numbers itself, and every card cites the signals it rests on.",
    tools: ["Deterministic metrics (read-only)", "Shared brain (weekly reports)"],
    model: "Sonnet + Haiku",
  },
  {
    id: "insights-qa-bot",
    name: "Ask the numbers",
    emoji: "🔢",
    where: "Insights ask dock",
    description: "Q&A over flow metrics, workload, and operations.",
    promptSummary:
      "Answers with figures pulled from the same metric functions the dashboards chart, citing (metric · lens) for every number.",
    tools: ["Flow metrics", "Attention", "Portfolio", "Workload", "Operations", "Weekly report", "Shared brain (gbrain)"],
    model: "Sonnet",
  },
  {
    id: "shift-brief-bot",
    name: "Shift brief",
    emoji: "🌅",
    where: "Home + My Week",
    description: "Your 'since your last shift' orientation paragraph.",
    promptSummary:
      "Writes only the one-paragraph read over a deterministic change payload; the widget renders the facts directly.",
    tools: ["Shift window data (read-only)", "Shared brain (gbrain)"],
    model: "Haiku",
  },
  {
    id: "triage-bot",
    name: "Intake triage",
    emoji: "🏷️",
    where: "New tasks",
    description: "Suggests team, assignee, and priority for bare new tasks.",
    promptSummary:
      "Suggestions only — values are validated against real candidates and applied by staff (or the owner's auto-apply dial).",
    tools: ["Similar-task evidence", "Candidate lists", "Brain evidence (prefetched)"],
    model: "Haiku",
  },
  {
    id: "guest-chatbots",
    name: "Guest chatbots",
    emoji: "🛎️",
    where: "Public guest pages",
    description: "The bots you build under Chatbots — front desk, orders, reservations.",
    promptSummary:
      "Injection-hardened guest runtime with only the tools each bot's config enables (knowledge, tickets, bookings, handoff).",
    tools: ["Per-bot: knowledge search", "Tickets", "Bookings", "Handoff"],
    model: "Haiku / Sonnet",
  },
  {
    id: "fleet-pod-bots",
    name: "Fleet pod bots",
    emoji: "🤖",
    where: "Channels (@name), pod properties only",
    description:
      "Operated bots on the durable agent runtime — persona from the pod's knowledge brain, tools per-bot allow-listed.",
    promptSummary:
      "Durable eve sessions per channel; money-moving tools always park for human approval (Fleet → Approvals). Full config and session logs are in the Fleet views.",
    tools: ["Per-bot allow-list", "Brain query/write", "Approval-gated money tools"],
    model: "Haiku / Sonnet",
  },
];
