/**
 * ClickUp → Hotelclaw task importer (A5 — the migration service).
 *
 *   node --env-file=.env.local scripts/import-clickup.mjs \
 *     --file ~/Downloads/clickup-export.csv --property <propertyId> [--dry-run]
 *
 * Takes a ClickUp CSV task export and rebuilds it in a property:
 *   - ClickUp Space (falling back to List) → hotelclaw team (space), created
 *     by name when missing, matched case-insensitively when present.
 *   - Status → todo/in_progress/blocked/done via keyword mapping, AND the
 *     ORIGINAL status is preserved on an "Imported status" select custom
 *     field (0080) so granular ladders (the maintenance flow) survive.
 *   - Priority urgent/high/normal/low → urgent/high/medium/low.
 *   - Assignee matched against member emails + profile names; unmatched
 *     assignees are left empty (reported at the end).
 *   - Parent/subtask links restored when the export carries "Parent ID"
 *     (two-pass: parents first).
 *   - Due dates parsed from epoch-ms or date strings.
 *
 * Tolerant of header variations (case-insensitive, several aliases per
 * column). Rows it can't place still import — into the property with no
 * team. `--dry-run` prints the plan without writing.
 */

import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

/* ── Args ─────────────────────────────────────────────────────────────────── */

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? null : process.argv[i + 1];
}
const FILE = arg("file");
const PROPERTY_ID = arg("property");
const DRY_RUN = process.argv.includes("--dry-run");
if (!FILE || !PROPERTY_ID) {
  console.error(
    "Usage: node --env-file=.env.local scripts/import-clickup.mjs --file <export.csv> --property <propertyId> [--dry-run]",
  );
  process.exit(1);
}

/* ── Minimal CSV parser (quotes, embedded commas/newlines) ────────────────── */

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    if (row.length > 1 || row[0] !== "") rows.push(row);
  }
  return rows;
}

/* ── Header detection ─────────────────────────────────────────────────────── */

const COLUMN_ALIASES = {
  id: ["task id", "task custom id", "id"],
  name: ["task name", "name", "title"],
  description: ["task content", "description", "content"],
  status: ["status"],
  priority: ["priority"],
  assignees: ["assignees", "assignee"],
  due: ["due date", "due date text", "due"],
  space: ["space", "space name"],
  list: ["list", "list name"],
  parent: ["parent id", "parent", "parent task id"],
  labels: ["tags", "labels"],
};

function buildColumnMap(header) {
  const lower = header.map((h) => h.trim().toLowerCase());
  const map = {};
  for (const [key, aliases] of Object.entries(COLUMN_ALIASES)) {
    for (const alias of aliases) {
      const idx = lower.indexOf(alias);
      if (idx !== -1) {
        map[key] = idx;
        break;
      }
    }
  }
  return map;
}

/* ── Value mapping ────────────────────────────────────────────────────────── */

function mapStatus(raw) {
  const s = (raw ?? "").trim().toLowerCase();
  if (!s) return "todo";
  if (/(complete|closed|done|finali[sz]ed)/.test(s)) return "done";
  if (/(progress|doing|active|review|scheduled)/.test(s)) return "in_progress";
  if (/(blocked|hold|waiting|stuck)/.test(s)) return "blocked";
  return "todo";
}

function mapPriority(raw) {
  const s = (raw ?? "").trim().toLowerCase();
  if (s.includes("urgent")) return "urgent";
  if (s.includes("high")) return "high";
  if (s.includes("low")) return "low";
  if (s.includes("normal") || s.includes("medium")) return "medium";
  return "none";
}

function parseDue(raw) {
  const s = (raw ?? "").trim();
  if (!s) return null;
  if (/^\d{12,}$/.test(s)) {
    const d = new Date(Number(s));
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function slugId(label) {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60);
}

/* ── Main ─────────────────────────────────────────────────────────────────── */

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

async function main() {
  const csv = fs.readFileSync(FILE, "utf8");
  const rows = parseCsv(csv);
  if (rows.length < 2) {
    console.error("No data rows found in the CSV");
    process.exit(1);
  }
  const cols = buildColumnMap(rows[0]);
  if (cols.name === undefined) {
    console.error(
      `Couldn't find a task-name column. Headers seen: ${rows[0].join(", ")}`,
    );
    process.exit(1);
  }
  console.log(
    `Parsed ${rows.length - 1} rows. Columns detected: ${Object.keys(cols).join(", ")}`,
  );

  const { data: property } = await supabase
    .from("properties")
    .select("id, name")
    .eq("id", PROPERTY_ID)
    .maybeSingle();
  if (!property) {
    console.error(`Property ${PROPERTY_ID} not found`);
    process.exit(1);
  }
  console.log(`Importing into: ${property.name}`);

  // Existing teams + members for matching.
  const [{ data: spaces }, { data: members }] = await Promise.all([
    supabase
      .from("spaces")
      .select("id, name")
      .eq("property_id", PROPERTY_ID)
      .is("archived_at", null),
    supabase
      .from("memberships")
      .select("user_id")
      .eq("property_id", PROPERTY_ID),
  ]);
  const memberIds = (members ?? []).map((m) => m.user_id);
  const { data: profiles } = memberIds.length
    ? await supabase.from("profiles").select("id, full_name").in("id", memberIds)
    : { data: [] };
  const { data: authUsers } = await supabase.auth.admin.listUsers({
    perPage: 1000,
  });
  const emailById = new Map(
    (authUsers?.users ?? [])
      .filter((u) => memberIds.includes(u.id))
      .map((u) => [u.id, (u.email ?? "").toLowerCase()]),
  );
  const findAssignee = (raw) => {
    const needle = (raw ?? "").trim().toLowerCase();
    if (!needle) return null;
    for (const [id, email] of emailById) {
      if (email && needle.includes(email)) return id;
    }
    for (const p of profiles ?? []) {
      if (p.full_name && needle.includes(p.full_name.toLowerCase())) return p.id;
    }
    return null;
  };

  const spaceByName = new Map(
    (spaces ?? []).map((s) => [s.name.toLowerCase(), s.id]),
  );

  // Parse all rows first.
  const tasks = rows.slice(1).map((row) => {
    const get = (key) => (cols[key] === undefined ? "" : (row[cols[key]] ?? ""));
    return {
      clickupId: get("id").trim() || null,
      title: get("name").trim().slice(0, 200),
      description: get("description").trim().slice(0, 5000) || null,
      rawStatus: get("status").trim(),
      status: mapStatus(get("status")),
      priority: mapPriority(get("priority")),
      assigneeId: findAssignee(get("assignees")),
      dueAt: parseDue(get("due")),
      teamName: (get("space").trim() || get("list").trim()) || null,
      parentClickupId: get("parent").trim() || null,
      labels: get("labels")
        .split(",")
        .map((l) => l.trim())
        .filter(Boolean)
        .slice(0, 8),
    };
  }).filter((t) => t.title);

  const teamNames = [...new Set(tasks.map((t) => t.teamName).filter(Boolean))];
  const newTeams = teamNames.filter((n) => !spaceByName.has(n.toLowerCase()));
  const statuses = [...new Set(tasks.map((t) => t.rawStatus).filter(Boolean))];
  const unmatchedAssignees = new Set(
    tasks
      .filter((t) => !t.assigneeId && cols.assignees !== undefined)
      .map((t) => (rows[tasks.indexOf(t) + 1]?.[cols.assignees] ?? "").trim())
      .filter(Boolean),
  );

  console.log(`\nPlan:`);
  console.log(`  ${tasks.length} tasks`);
  console.log(
    `  Teams: ${teamNames.length} referenced, ${newTeams.length} to create (${newTeams.join(", ") || "none"})`,
  );
  console.log(`  Original statuses preserved: ${statuses.join(", ") || "none"}`);
  console.log(
    `  Subtask links: ${tasks.filter((t) => t.parentClickupId).length}`,
  );
  if (unmatchedAssignees.size > 0) {
    console.log(
      `  ⚠ Unmatched assignees (left empty): ${[...unmatchedAssignees].slice(0, 10).join("; ")}`,
    );
  }
  if (DRY_RUN) {
    console.log("\nDry run — nothing written.");
    return;
  }

  // Create missing teams.
  for (const name of newTeams) {
    const { data, error } = await supabase
      .from("spaces")
      .insert({ property_id: PROPERTY_ID, name: name.slice(0, 80) })
      .select("id")
      .single();
    if (error) {
      console.error(`  team "${name}" failed: ${error.message}`);
      continue;
    }
    spaceByName.set(name.toLowerCase(), data.id);
    console.log(`  + team ${name}`);
  }

  // "Imported status" custom field with every original status as an option.
  let importedStatusFieldId = null;
  if (statuses.length > 0) {
    const { data: existingField } = await supabase
      .from("custom_fields")
      .select("id, options")
      .eq("property_id", PROPERTY_ID)
      .eq("name", "Imported status")
      .is("archived_at", null)
      .maybeSingle();
    const options = statuses.map((label) => ({ id: slugId(label), label }));
    if (existingField) {
      const merged = [...existingField.options];
      for (const o of options) {
        if (!merged.some((m) => m.id === o.id)) merged.push(o);
      }
      await supabase
        .from("custom_fields")
        .update({ options: merged })
        .eq("id", existingField.id);
      importedStatusFieldId = existingField.id;
    } else {
      const { data: field } = await supabase
        .from("custom_fields")
        .insert({
          property_id: PROPERTY_ID,
          name: "Imported status",
          type: "select",
          options,
        })
        .select("id")
        .single();
      importedStatusFieldId = field?.id ?? null;
    }
  }

  // Insert tasks (parents first, then children referencing the id map).
  const idByClickup = new Map();
  const roots = tasks.filter((t) => !t.parentClickupId);
  const children = tasks.filter((t) => t.parentClickupId);
  let inserted = 0;
  let failed = 0;

  async function insertTask(t, parentId) {
    const { data, error } = await supabase
      .from("tasks")
      .insert({
        property_id: PROPERTY_ID,
        title: t.title,
        description: t.description,
        status: t.status,
        priority: t.priority,
        assignee_id: t.assigneeId,
        due_at: t.dueAt,
        space_id: t.teamName
          ? (spaceByName.get(t.teamName.toLowerCase()) ?? null)
          : null,
        parent_id: parentId,
        labels: t.labels,
        source: "user",
      })
      .select("id")
      .single();
    if (error || !data) {
      failed++;
      console.error(`  ✗ ${t.title}: ${error?.message}`);
      return null;
    }
    inserted++;
    if (t.clickupId) idByClickup.set(t.clickupId, data.id);
    if (importedStatusFieldId && t.rawStatus) {
      await supabase.from("task_field_values").upsert(
        {
          task_id: data.id,
          field_id: importedStatusFieldId,
          property_id: PROPERTY_ID,
          value: slugId(t.rawStatus),
        },
        { onConflict: "task_id,field_id" },
      );
    }
    return data.id;
  }

  for (const t of roots) await insertTask(t, null);
  for (const t of children) {
    const parentId = idByClickup.get(t.parentClickupId) ?? null;
    await insertTask(t, parentId);
  }

  console.log(`\nDone: ${inserted} imported, ${failed} failed.`);
  if (statuses.length > 0) {
    console.log(
      `Original ClickUp statuses live on the "Imported status" field — filter and automate on them from day one.`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
