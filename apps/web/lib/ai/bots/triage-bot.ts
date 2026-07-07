import "server-only";
/**
 * Intake triage bot (Tier 1) — suggests routing fields for bare new tasks.
 *
 * Trust ladder: every suggestion carries its reasoning and lands as a
 * `task_suggestions` row. Humans accept/dismiss (recorded); owners can
 * graduate a field to auto-apply via `triage_settings`, in which case a
 * high-confidence suggestion is applied immediately but STILL writes its
 * row (status 'auto_applied') so the provenance stays inspectable and the
 * dial can be turned back down.
 *
 * The model picks only from validated candidate lists (real space ids,
 * member ids, priority values) — an invented id is dropped, never applied.
 */
import { generateText, Output } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/server";

const TRIAGE_MODEL = "claude-haiku-4-5-20251001";

const PRIORITIES = ["low", "medium", "high", "urgent"] as const;

const SuggestionSchema = z.object({
  suggestions: z
    .array(
      z.object({
        field: z.enum(["space", "assignee", "priority"]),
        value: z
          .string()
          .describe("EXACTLY one id/value from the candidates for that field."),
        reasoning: z
          .string()
          .describe(
            "One short sentence a manager can verify at a glance — cite the signal (similar task, name match, keyword).",
          ),
        confidence: z.enum(["low", "medium", "high"]),
      }),
    )
    .max(3)
    .describe(
      "At most one suggestion per missing field. Suggest nothing for a field rather than guessing.",
    ),
});

export type TriageResult = {
  taskId: string;
  suggested: number;
  autoApplied: number;
};

export async function triageTask(opts: {
  propertyId: string;
  taskId: string;
}): Promise<TriageResult | null> {
  const supabase = createServiceClient();

  const { data: task } = await supabase
    .from("tasks")
    .select("id, title, description, status, priority, assignee_id, space_id, project_id")
    .eq("id", opts.taskId)
    .eq("property_id", opts.propertyId)
    .maybeSingle();
  if (!task) return null;

  const missing = {
    space: !task.space_id,
    assignee: !task.assignee_id,
    priority: task.priority === "none",
  };
  if (!missing.space && !missing.assignee && !missing.priority) return null;

  // One triage per task — re-running on edit would fight the human.
  const { count: existing } = await supabase
    .from("task_suggestions")
    .select("id", { count: "exact", head: true })
    .eq("task_id", opts.taskId);
  if ((existing ?? 0) > 0) return null;

  if (!process.env.ANTHROPIC_API_KEY) return null;

  // ── Candidates + deterministic evidence ──────────────────────────────────
  const [spacesRes, membersRes, tasksRes] = await Promise.all([
    supabase
      .from("spaces")
      .select("id, name")
      .eq("property_id", opts.propertyId)
      .is("archived_at", null),
    supabase
      .from("memberships")
      .select("user_id, role")
      .eq("property_id", opts.propertyId),
    supabase
      .from("tasks")
      .select("title, space_id, assignee_id, priority")
      .eq("property_id", opts.propertyId)
      .neq("id", opts.taskId)
      .order("created_at", { ascending: false })
      .limit(300),
  ]);
  const spaces = spacesRes.data ?? [];
  const memberIds = (membersRes.data ?? []).map((m) => m.user_id);
  const { data: profiles } = memberIds.length
    ? await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", memberIds)
    : { data: [] };
  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));
  const spaceNameById = new Map(spaces.map((s) => [s.id, s.name]));
  const members = (membersRes.data ?? []).map((m) => ({
    id: m.user_id,
    name: nameById.get(m.user_id) ?? null,
    role: m.role,
  }));

  // Similar tasks by shared title words — cheap, deterministic evidence the
  // model cites instead of inventing patterns.
  const words = new Set(
    (task.title ?? "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 3),
  );
  const similar = (tasksRes.data ?? [])
    .map((t) => ({
      t,
      overlap: t.title
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => words.has(w)).length,
    }))
    .filter((x) => x.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap)
    .slice(0, 6)
    .map(({ t }) => ({
      title: t.title,
      space: t.space_id ? (spaceNameById.get(t.space_id) ?? null) : null,
      spaceId: t.space_id,
      assignee: t.assignee_id ? (nameById.get(t.assignee_id) ?? null) : null,
      assigneeId: t.assignee_id,
      priority: t.priority,
    }));

  const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  let result;
  try {
    result = await generateText({
      model: anthropic(TRIAGE_MODEL),
      output: Output.object({ schema: SuggestionSchema }),
      temperature: 0,
      maxRetries: 2,
      system: [
        "You triage new tasks in a hotel/restaurant team workspace: suggest which team (space) should own a task, who should do it, and how urgent it is.",
        "Rules:",
        "- Suggest ONLY for the fields listed as missing. At most one suggestion per field.",
        "- `value` must be EXACTLY an id/value from the candidates. Anything else is discarded.",
        "- Ground reasoning in the evidence given (similar tasks, name/keyword matches, member roles). If the evidence is weak, mark confidence low or omit the field entirely.",
        "- Assignee suggestions should prefer people who handled similar work; never suggest someone with no signal.",
      ].join("\n"),
      prompt: JSON.stringify(
        {
          task: { title: task.title, description: task.description ?? null },
          missingFields: Object.entries(missing)
            .filter(([, v]) => v)
            .map(([k]) => k),
          candidates: {
            spaces,
            members,
            priorities: PRIORITIES,
          },
          similarTasks: similar,
        },
        null,
        2,
      ),
    });
  } catch (err) {
    console.error("[triage] generation failed", opts.taskId, err);
    return null;
  }

  // ── Validate against the candidate lists; drop anything invented ─────────
  const validSpaceIds = new Set(spaces.map((s) => s.id));
  const validMemberIds = new Set(members.map((m) => m.id));
  const valid = result.output.suggestions.filter((s) => {
    if (s.field === "space") return missing.space && validSpaceIds.has(s.value);
    if (s.field === "assignee")
      return missing.assignee && validMemberIds.has(s.value);
    return (
      missing.priority &&
      (PRIORITIES as readonly string[]).includes(s.value)
    );
  });
  if (valid.length === 0) return { taskId: opts.taskId, suggested: 0, autoApplied: 0 };

  const { data: settings } = await supabase
    .from("triage_settings")
    .select("auto_apply")
    .eq("property_id", opts.propertyId)
    .maybeSingle();
  const autoApply = (settings?.auto_apply ?? {}) as Partial<
    Record<"space" | "assignee" | "priority", boolean>
  >;

  let autoApplied = 0;
  for (const s of valid) {
    const displayValue =
      s.field === "space"
        ? (spaceNameById.get(s.value) ?? s.value)
        : s.field === "assignee"
          ? (nameById.get(s.value) ?? "Member")
          : s.value;
    const apply = autoApply[s.field] === true && s.confidence === "high";

    if (apply) {
      const patch =
        s.field === "space"
          ? { space_id: s.value }
          : s.field === "assignee"
            ? { assignee_id: s.value }
            : { priority: s.value as (typeof PRIORITIES)[number] };
      const { error } = await supabase
        .from("tasks")
        .update(patch)
        .eq("id", opts.taskId)
        .eq("property_id", opts.propertyId);
      if (!error) autoApplied += 1;
    }

    await supabase.from("task_suggestions").upsert(
      {
        property_id: opts.propertyId,
        task_id: opts.taskId,
        field: s.field,
        suggested_value: s.value,
        display_value: displayValue ?? s.value,
        reasoning: s.reasoning,
        confidence: s.confidence,
        status: apply ? "auto_applied" : "pending",
        model: TRIAGE_MODEL,
        ...(apply ? { resolved_at: new Date().toISOString() } : {}),
      },
      { onConflict: "task_id,field" },
    );
  }

  return { taskId: opts.taskId, suggested: valid.length, autoApplied };
}
