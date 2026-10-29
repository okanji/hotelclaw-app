"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Inbox, Search, TriangleAlert } from "lucide-react";
import { Gi } from "@/components/gr8r/icon";
import { G8Empty } from "@/components/gr8r/members-shared";
import { cn } from "@/lib/utils";
import { Chip } from "@/components/ui/chip";
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
    return (
      <div className="panel">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="mini" style={{ cursor: "default" }}>
            <span className="sk" style={{ width: 140, height: 12 }} />
            <span className="sk" style={{ width: 80, height: 10, marginLeft: "auto" }} />
          </div>
        ))}
      </div>
    );
  }
  if (error) {
    return (
      <div className="alert danger">
        <Gi icon={TriangleAlert} size={15} />
        <span>{error instanceof Error ? error.message : "Failed to load responses"}</span>
      </div>
    );
  }

  if (responses.length === 0) {
    return (
      <G8Empty
        icon={Inbox}
        title="No responses yet"
        text={
          status === "published"
            ? "Share the fill link to start collecting."
            : "Publish the form to start collecting."
        }
      />
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
      <div className="row" style={{ gap: 10, alignItems: "baseline" }}>
        <h2 className="sec">
          {responses.length} {responses.length === 1 ? "response" : "responses"}
        </h2>
        {filtering ? (
          <span className="faint num" style={{ fontSize: 12 }}>
            {shownResponses.length} shown
          </span>
        ) : null}
        {latest ? (
          <span className="faint" style={{ fontSize: 12 }}>
            Latest {formatDate(latest)}
          </span>
        ) : null}
      </div>

      <SummaryStrip fields={fields} responses={responses} />

      {/* Filter toolbar — search across answers + respondent, and option
          chips for the leading choice fields. All client-side. */}
      <div className="flex flex-col gap-2">
        <div className="inwrap" style={{ alignSelf: "flex-start" }}>
          <Gi icon={Search} size={13} />
          <input
            className="input search-sm"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search responses…"
            aria-label="Search responses"
          />
        </div>
        {chipFields.map(({ field, options, counts }) => {
          const active = chipFilters[field.id] ?? null;
          return (
            <div key={field.id} className="flex flex-wrap items-center gap-1.5">
              <span className="eyebrow trunc" style={{ maxWidth: 160 }}>
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
                // as answers arrive.
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
      <div className="panel" style={{ overflowX: "auto" }}>
        <table className="perm-t g8-resp-t">
          <thead>
            <tr>
              {hasMore ? <th style={{ width: 32 }} /> : null}
              <th>Respondent</th>
              {visible.map((f) => (
                <th key={f.id} className="trunc" style={{ maxWidth: 176 }}>
                  {f.label}
                </th>
              ))}
              <th>
                <button
                  type="button"
                  onClick={() =>
                    setSortDir((d) => (d === "newest" ? "oldest" : "newest"))
                  }
                  aria-label={`Sort by submitted date, ${
                    sortDir === "newest" ? "newest" : "oldest"
                  } first`}
                  className="row"
                  style={{ gap: 4 }}
                >
                  Submitted
                  <Gi
                    icon={ChevronDown}
                    size={13}
                    className={sortDir === "oldest" ? "rotate-180" : undefined}
                  />
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {shownResponses.length === 0 ? (
              <tr>
                <td colSpan={colSpan} className="muted" style={{ textAlign: "center", padding: 32 }}>
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
      <tr>
        {hasMore ? (
          <td>
            <button
              type="button"
              onClick={onToggle}
              aria-label={expanded ? "Collapse row" : "Expand row"}
              aria-expanded={expanded}
              className="ibtn ibtn-xs"
            >
              <Gi icon={ChevronRight} size={13} className={expanded ? "chev open" : "chev"} />
            </button>
          </td>
        ) : null}
        <td style={{ fontWeight: 500, whiteSpace: "nowrap" }}>
          {response.respondent?.name ?? "Anonymous"}
        </td>
        {visible.map((f) => (
          <td key={f.id} className="trunc" style={{ maxWidth: 176 }}>
            <AnswerCell
              field={f}
              value={response.answers[f.id]}
              labels={sourcedLabels[f.id]}
            />
          </td>
        ))}
        <td className="muted num" style={{ whiteSpace: "nowrap" }}>
          {formatDate(response.created_at)}
        </td>
      </tr>
      {expanded ? (
        <tr className="g8-resp-more">
          <td colSpan={colSpan}>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2" style={{ margin: 0 }}>
              {allFields.map((f) => (
                <div key={f.id}>
                  <dt className="faint" style={{ fontSize: 12 }}>{f.label}</dt>
                  <dd style={{ margin: 0 }}>
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
    <div className="row" style={{ gap: 12, overflowX: "auto", paddingBottom: 4, alignItems: "stretch" }}>
      {summaries.map((s) => (
        // gr8r `.panel` tile per summarised question: `.eyebrow` label, then
        // the rating average or a `.prog` meter per option.
        <div key={s.field.id} className="panel" style={{ width: 224, flexShrink: 0, padding: 12 }}>
          <div className="eyebrow trunc">{s.field.label}</div>
          {s.kind === "rating" ? (
            <p className="num" style={{ margin: "8px 0 0", fontSize: "var(--g8-fs-2xl)", fontWeight: 600 }}>
              {s.avg.toFixed(1)}
              <span className="muted" style={{ fontSize: 12.5, fontWeight: 400 }}>
                /{s.field.maxRating ?? 5} avg · {s.count}
              </span>
            </p>
          ) : (
            <div className="col" style={{ gap: 6, marginTop: 8 }}>
              {s.labels.map((opt) => {
                const count = s.counts.get(opt.id) ?? 0;
                const frac = s.total > 0 ? count / s.total : 0;
                return (
                  <div key={opt.id} style={{ fontSize: 12 }}>
                    <div className="row" style={{ gap: 8 }}>
                      <span className="trunc muted grow">{opt.label}</span>
                      <span className="num">{count}</span>
                    </div>
                    <div className="prog" style={{ marginTop: 3 }}>
                      <i style={{ "--g8-p": frac } as React.CSSProperties} />
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
