"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Chip } from "@/components/ui/chip";
import { Input } from "@/components/ui/input";
import {
  FormFileValueZod,
  formatAnswer,
  inputFields,
  type FormAnswers,
  type FormAnswerValue,
  type FormField,
  type FormSchema,
} from "@/lib/forms/schema";
import type { FormResponseSource, FormStatus } from "@/lib/db/types";

/**
 * The Responses tab — searchable table of submissions, chip filters on the
 * first choice fields, and per-field summaries. Fed the builder's LIVE
 * working schema (autosave never refreshes the server props), so a question
 * added a moment ago already has its column.
 */

type ResponseRow = {
  id: string;
  answers: FormAnswers;
  source: FormResponseSource;
  created_at: string;
  respondent: { id: string; name: string | null } | null;
};

type ResponsesPayload = {
  responses: ResponseRow[];
  /** fieldId → (answer id → display label) for sourced choice/people fields. */
  sourcedLabels: Record<string, Record<string, string>>;
};

export function responsesQueryOptions(propertyId: string, formId: string) {
  return {
    queryKey: ["form-responses", formId],
    queryFn: async (): Promise<ResponsesPayload> => {
      const res = await fetch(`/api/properties/${propertyId}/forms/${formId}/responses`);
      const body = (await res.json()) as Partial<ResponsesPayload> & { error?: string };
      if (!res.ok || !body.responses) throw new Error(body.error ?? "Failed to load");
      return { responses: body.responses, sourcedLabels: body.sourcedLabels ?? {} };
    },
  };
}

const MAX_VISIBLE_COLUMNS = 5;

const EMPTY_RESPONSES: ResponseRow[] = [];
const EMPTY_SOURCED_LABELS: Record<string, Record<string, string>> = {};

const YES_NO_OPTIONS = [
  { id: "yes", label: "Yes" },
  { id: "no", label: "No" },
] as const;

/** The option ids an answer picked, for chip filtering. */
function answerOptionIds(
  field: FormField,
  value: FormAnswerValue | undefined,
): string[] {
  if (field.type === "yes_no") {
    return value === true ? ["yes"] : value === false ? ["no"] : [];
  }
  if (typeof value === "string") return value ? [value] : [];
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === "string");
  }
  return [];
}

/** Lowercased haystack for the responses search: respondent name + every
 *  answer's display text (sourced ids map through their resolved labels). */
function responseSearchText(
  response: ResponseRow,
  fields: FormField[],
  sourcedLabels: Record<string, Record<string, string>>,
): string {
  const parts: string[] = [response.respondent?.name ?? "Anonymous"];
  for (const field of fields) {
    const value = response.answers[field.id];
    const labels = sourcedLabels[field.id];
    if (labels && typeof value === "string" && value) {
      parts.push(labels[value] ?? value);
    } else if (labels && Array.isArray(value)) {
      parts.push(
        value
          .filter((v): v is string => typeof v === "string")
          .map((v) => labels[v] ?? v)
          .join(" "),
      );
    } else {
      parts.push(formatAnswer(field, value));
    }
  }
  return parts.join(" ").toLowerCase();
}

export function ResponsesTab({
  propertyId,
  formId,
  status,
  schema,
}: {
  propertyId: string;
  formId: string;
  status: FormStatus;
  schema: FormSchema;
}) {
  const fields = useMemo(() => inputFields(schema), [schema]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  /** fieldId → selected option id (absent/null = "All"). Single-select. */
  const [chipFilters, setChipFilters] = useState<Record<string, string | null>>({});
  const [sortDir, setSortDir] = useState<"newest" | "oldest">("newest");

  const { data, isPending, error } = useQuery(responsesQueryOptions(propertyId, formId));
  const responses = data?.responses ?? EMPTY_RESPONSES;
  const sourcedLabels = data?.sourcedLabels ?? EMPTY_SOURCED_LABELS;

  // Chip rows for the first 2 select / yes-no fields that have any answers
  // (the same fields that earn a SummaryStrip tile) — more would be chip soup.
  const chipFields = useMemo(() => {
    const out: {
      field: FormField;
      options: { id: string; label: string }[];
      counts: Map<string, number>;
    }[] = [];
    for (const field of fields) {
      if (out.length >= 2) break;
      if (field.type !== "select" && field.type !== "yes_no") continue;
      const options =
        field.type === "yes_no" ? [...YES_NO_OPTIONS] : (field.options ?? []);
      if (options.length === 0) continue; // sourced selects have no stored options
      const counts = new Map<string, number>(options.map((o) => [o.id, 0]));
      let total = 0;
      for (const r of responses) {
        for (const id of answerOptionIds(field, r.answers[field.id])) {
          if (counts.has(id)) {
            counts.set(id, (counts.get(id) ?? 0) + 1);
            total += 1;
          }
        }
      }
      if (total === 0) continue;
      out.push({ field, options, counts });
    }
    return out;
  }, [fields, responses]);

  const searchTexts = useMemo(
    () =>
      new Map(
        responses.map((r) => [r.id, responseSearchText(r, fields, sourcedLabels)]),
      ),
    [responses, fields, sourcedLabels],
  );

  const shownResponses = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = responses.filter((r) => {
      if (q && !(searchTexts.get(r.id) ?? "").includes(q)) return false;
      for (const cf of chipFields) {
        const picked = chipFilters[cf.field.id];
        if (
          picked &&
          !answerOptionIds(cf.field, r.answers[cf.field.id]).includes(picked)
        ) {
          return false;
        }
      }
      return true;
    });
    rows.sort((a, b) =>
      sortDir === "newest"
        ? Date.parse(b.created_at) - Date.parse(a.created_at)
        : Date.parse(a.created_at) - Date.parse(b.created_at),
    );
    return rows;
  }, [responses, search, searchTexts, chipFields, chipFilters, sortDir]);

  if (isPending) {
    return <p className="py-12 text-center text-sm text-muted-foreground">Loading responses…</p>;
  }
  if (error) {
    return (
      <p className="py-12 text-center text-sm text-destructive">
        {error instanceof Error ? error.message : "Failed to load responses"}
      </p>
    );
  }

  if (responses.length === 0) {
    return (
      <div className="rounded-md p-12 text-center">
        <p className="text-sm font-medium">No responses yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {status === "published"
            ? "Share the fill link to start collecting."
            : "Publish the form to start collecting."}
        </p>
      </div>
    );
  }

  const visible = fields.slice(0, MAX_VISIBLE_COLUMNS);
  const hasMore = fields.length > MAX_VISIBLE_COLUMNS;
  const latest = responses[0]?.created_at;
  const filtering =
    search.trim() !== "" || chipFields.some((cf) => chipFilters[cf.field.id]);
  const colSpan = visible.length + 2 + (hasMore ? 1 : 0);

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline gap-3 text-sm">
        <span className="font-semibold">
          {responses.length} {responses.length === 1 ? "response" : "responses"}
        </span>
        {filtering ? (
          <span className="text-xs text-muted-foreground">
            {shownResponses.length} shown
          </span>
        ) : null}
        {latest ? (
          <span className="text-xs text-muted-foreground">
            Latest {formatDate(latest)}
          </span>
        ) : null}
      </div>

      <SummaryStrip fields={fields} responses={responses} />

      {/* Filter toolbar — search across answers + respondent, and option
          chips for the leading choice fields. All client-side. */}
      <div className="flex flex-col gap-2">
        <div className="relative w-64 max-w-full">
          <Search className="absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-faint-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search responses…"
            aria-label="Search responses"
            className="h-8 pl-7"
          />
        </div>
        {chipFields.map(({ field, options, counts }) => {
          const active = chipFilters[field.id] ?? null;
          return (
            <div key={field.id} className="flex flex-wrap items-center gap-1.5">
              <span className="max-w-40 truncate text-xs font-medium text-faint-foreground">
                {field.label}
              </span>
              <Chip
                size="sm"
                selected={active === null}
                onClick={() =>
                  setChipFilters((prev) => ({ ...prev, [field.id]: null }))
                }
              >
                All
                <span className="tabular-nums opacity-70">{responses.length}</span>
              </Chip>
              {options.map((opt) => {
                const count = counts.get(opt.id) ?? 0;
                // Zero-count chips stay (disabled) so the row doesn't reflow
                // as answers arrive — the bookings agenda pattern.
                const empty = count === 0;
                return (
                  <Chip
                    key={opt.id}
                    size="sm"
                    selected={active === opt.id}
                    disabled={empty}
                    onClick={() =>
                      setChipFilters((prev) => ({
                        ...prev,
                        [field.id]: active === opt.id ? null : opt.id,
                      }))
                    }
                    className={cn(empty && "opacity-40")}
                  >
                    {opt.label}
                    <span className="tabular-nums opacity-70">{count}</span>
                  </Chip>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* Notion database table (notion-spec-v2 §6): 36px header of 14px w400
          tertiary labels, 37px rows, BOTH dividers, no zebra, no outer
          frame — a data view breaks out of the document column. */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="h-9 border-b border-border text-left font-normal text-muted-foreground">
              {hasMore ? (
                <th className="w-8 border-r border-border px-2 font-normal" />
              ) : null}
              <th className="border-r border-border px-2 font-normal">
                Respondent
              </th>
              {visible.map((f) => (
                <th
                  key={f.id}
                  className="max-w-44 truncate border-r border-border px-2 font-normal"
                >
                  {f.label}
                </th>
              ))}
              <th className="px-2 font-normal">
                <button
                  type="button"
                  onClick={() =>
                    setSortDir((d) => (d === "newest" ? "oldest" : "newest"))
                  }
                  aria-label={`Sort by submitted date, ${
                    sortDir === "newest" ? "newest" : "oldest"
                  } first`}
                  className="-mx-1 inline-flex items-center gap-1 rounded-md px-1 hover:bg-accent"
                >
                  Submitted
                  <ChevronDown
                    className={cn(
                      "size-3.5 transition-transform",
                      sortDir === "oldest" && "rotate-180",
                    )}
                  />
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {shownResponses.length === 0 ? (
              <tr>
                <td
                  colSpan={colSpan}
                  className="py-8 text-center text-muted-foreground"
                >
                  No responses match your filters.
                </td>
              </tr>
            ) : (
              shownResponses.map((r) => (
                <ResponseRows
                  key={r.id}
                  response={r}
                  visible={visible}
                  allFields={fields}
                  hasMore={hasMore}
                  expanded={expanded.has(r.id)}
                  onToggle={() => toggle(r.id)}
                  sourcedLabels={sourcedLabels}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ResponseRows({
  response,
  visible,
  allFields,
  hasMore,
  expanded,
  onToggle,
  sourcedLabels,
}: {
  response: ResponseRow;
  visible: FormField[];
  allFields: FormField[];
  hasMore: boolean;
  expanded: boolean;
  onToggle: () => void;
  sourcedLabels: Record<string, Record<string, string>>;
}) {
  const colSpan = visible.length + 2 + (hasMore ? 1 : 0);
  return (
    <>
      <tr className="h-[37px] border-b border-border last:border-0">
        {hasMore ? (
          <td className="border-r border-border px-2">
            <button
              type="button"
              onClick={onToggle}
              aria-label={expanded ? "Collapse row" : "Expand row"}
              className="flex size-5 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
            >
              <ChevronRight
                className={cn("size-3.5 transition-transform", expanded && "rotate-90")}
              />
            </button>
          </td>
        ) : null}
        {/* The name cell is the UI-row rung: 14px w500 primary. */}
        <td className="border-r border-border px-2 font-medium whitespace-nowrap">
          {response.respondent?.name ?? "Anonymous"}
        </td>
        {visible.map((f) => (
          <td
            key={f.id}
            className="max-w-44 truncate border-r border-border px-2"
          >
            <AnswerCell
              field={f}
              value={response.answers[f.id]}
              labels={sourcedLabels[f.id]}
            />
          </td>
        ))}
        <td className="px-2 whitespace-nowrap text-muted-foreground">
          {formatDate(response.created_at)}
        </td>
      </tr>
      {expanded ? (
        <tr className="border-b border-border bg-muted last:border-0">
          <td colSpan={colSpan} className="px-2 py-3">
            <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
              {allFields.map((f) => (
                <div key={f.id}>
                  <dt className="text-xs text-muted-foreground">{f.label}</dt>
                  <dd className="text-sm">
                    <AnswerCell
                      field={f}
                      value={response.answers[f.id]}
                      labels={sourcedLabels[f.id]}
                    />
                  </dd>
                </div>
              ))}
            </dl>
          </td>
        </tr>
      ) : null}
    </>
  );
}

/**
 * One answer in the responses view — file answers render as links to the
 * uploaded objects (the bucket is public), signatures render the drawn
 * image, sourced choice / people answers map through the resolved labels;
 * everything else goes through formatAnswer().
 */
function AnswerCell({
  field,
  value,
  labels,
}: {
  field: FormField;
  value: FormAnswerValue | undefined;
  labels?: Record<string, string>;
}) {
  if (field.type === "file" && Array.isArray(value)) {
    const files = value
      .map((v) => FormFileValueZod.safeParse(v))
      .filter((r) => r.success)
      .map((r) => r.data);
    if (files.length === 0) return <>—</>;
    return (
      <span className="inline-flex flex-wrap gap-x-2 gap-y-0.5">
        {files.map((f, i) => (
          <a
            key={`${f.url}-${i}`}
            href={f.url}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2 hover:text-foreground"
          >
            {f.name}
          </a>
        ))}
      </span>
    );
  }
  if (
    field.type === "signature" &&
    typeof value === "string" &&
    value.startsWith("data:image/")
  ) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={value} alt="Signature" className="h-8 w-auto max-w-32 object-contain" />
    );
  }
  if (labels) {
    if (typeof value === "string" && value) {
      return <>{labels[value] ?? value}</>;
    }
    if (Array.isArray(value)) {
      const names = value
        .filter((v): v is string => typeof v === "string")
        .map((v) => labels[v] ?? v);
      if (names.length > 0) return <>{names.join(", ")}</>;
    }
  }
  return <>{formatAnswer(field, value)}</>;
}

/** Per-field aggregates for choice/rating/yes-no fields — quick read on the
 *  distribution before scanning the table. */
function SummaryStrip({
  fields,
  responses,
}: {
  fields: FormField[];
  responses: ResponseRow[];
}) {
  const summaries = fields
    .map((field) => {
      if (field.type === "rating") {
        const values = responses
          .map((r) => r.answers[field.id])
          .filter((v): v is number => typeof v === "number");
        if (values.length === 0) return null;
        const avg = values.reduce((a, b) => a + b, 0) / values.length;
        return { field, kind: "rating" as const, avg, count: values.length };
      }
      if (field.type === "select" || field.type === "multi_select" || field.type === "yes_no") {
        const labels =
          field.type === "yes_no"
            ? [
                { id: "yes", label: "Yes" },
                { id: "no", label: "No" },
              ]
            : (field.options ?? []);
        const counts = new Map<string, number>(labels.map((o) => [o.id, 0]));
        for (const r of responses) {
          const v = r.answers[field.id];
          const picked =
            field.type === "yes_no"
              ? v === true
                ? ["yes"]
                : v === false
                  ? ["no"]
                  : []
              : Array.isArray(v)
                ? v.filter((x): x is string => typeof x === "string")
                : typeof v === "string"
                  ? [v]
                  : [];
          for (const id of picked) {
            if (counts.has(id)) counts.set(id, (counts.get(id) ?? 0) + 1);
          }
        }
        const total = [...counts.values()].reduce((a, b) => a + b, 0);
        if (total === 0) return null;
        return { field, kind: "choices" as const, labels, counts, total };
      }
      return null;
    })
    .filter((s) => s !== null);

  if (summaries.length === 0) return null;

  return (
    <div className="flex gap-3 overflow-x-auto pb-1">
      {summaries.map((s) => (
        <div
          key={s.field.id}
          className="w-56 shrink-0 rounded-card p-3 shadow-ring"
        >
          {/* A per-field summary tile is a WELL, not a page: bare warm ring,
              no card shadow, and its heading is a 12px section label. */}
          <p className="truncate text-xs font-medium text-faint-foreground">
            {s.field.label}
          </p>
          {s.kind === "rating" ? (
            <p className="mt-2 text-2xl font-semibold">
              {s.avg.toFixed(1)}
              <span className="text-sm font-normal text-muted-foreground">
                /{s.field.maxRating ?? 5} avg · {s.count}
              </span>
            </p>
          ) : (
            <div className="mt-2 space-y-1.5">
              {s.labels.map((opt) => {
                const count = s.counts.get(opt.id) ?? 0;
                const pct = s.total > 0 ? (count / s.total) * 100 : 0;
                return (
                  <div key={opt.id} className="text-xs">
                    <div className="flex justify-between gap-2">
                      <span className="truncate text-muted-foreground">{opt.label}</span>
                      <span className="shrink-0 tabular-nums">{count}</span>
                    </div>
                    <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-muted">
                      <div
                        // Answer-distribution meter — a VALUE, so warm ink
                        // (same call as `ui/progress`), never `--primary`.
                        className="h-full rounded-full bg-secondary-ink"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------ Preview tab ------------------------------ */

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
