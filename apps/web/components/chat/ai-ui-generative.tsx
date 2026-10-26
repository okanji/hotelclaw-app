"use client";

import { useMemo, useState, type FormEvent } from "react";
import { CheckCircle2 } from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  chartSeries,
  formatFormSubmission,
  type ChatUiChartProps,
  type ChatUiFormField,
  type ChatUiQuestion,
} from "@hotelclaw/chat-ui";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Questionnaire,
  QuestionnaireActions,
  QuestionnaireChoice,
  QuestionnaireChoiceDescription,
  QuestionnaireChoices,
  QuestionnaireDescription,
  QuestionnaireError,
  QuestionnaireInput,
  QuestionnaireItem,
  QuestionnaireNext,
  QuestionnairePrevious,
  QuestionnaireProgress,
  QuestionnaireSkip,
  QuestionnaireSubmit,
  QuestionnaireTitle,
} from "@/components/ui/questionnaire";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useChatUiSubmitted, useOptionalChatUiSend } from "./chat-ui-send-context";

/**
 * The generative-UI half of the chat catalog — the three `render_ui`
 * element types that go beyond display:
 *
 *  - Chart — data visualization (recharts, the documents' chart block's
 *    data model and the shared `--series-*` ramp).
 *  - Form — an inline chat form (AI SDK "generative UI": the model asks for
 *    several details at once; submitting sends the answers as the person's
 *    next message in the fixed `formatFormSubmission` shape).
 *  - Questionnaire — the shadcn/ui Questionnaire primitive: one question
 *    per step, fixed choices, optional free text, progress and shortcuts.
 *
 * Both forms settle to one "Answers sent" line once submitted, exactly
 * like Options chips, so a transcript never shows a live form twice.
 */

const SERIES = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `var(--series-${n})`);

export function ChatUiChart({ props }: { props: ChatUiChartProps }) {
  const { categories, series } = useMemo(() => chartSeries(props), [props]);
  const data = useMemo(
    () =>
      categories.map((category, i) => {
        const row: Record<string, string | number> = { category };
        for (const s of series) row[s.name] = s.values[i] ?? 0;
        return row;
      }),
    [categories, series],
  );
  const first = series[0];

  const chart = (() => {
    switch (props.kind) {
      case "pie":
        return (
          <PieChart>
            <Pie
              data={first ? categories.map((c, i) => ({ name: c, value: first.values[i] ?? 0 })) : []}
              dataKey="value"
              nameKey="name"
              innerRadius="45%"
              outerRadius="80%"
              paddingAngle={2}
              stroke="var(--background)"
            >
              {categories.map((_, i) => (
                <Cell key={i} fill={SERIES[i % SERIES.length]} />
              ))}
            </Pie>
            <Tooltip contentStyle={TOOLTIP} />
            <Legend wrapperStyle={LEGEND} />
          </PieChart>
        );
      case "line":
        return (
          <LineChart data={data} margin={MARGIN}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="category" tick={TICK} axisLine={false} tickLine={false} />
            <YAxis tick={TICK} axisLine={false} tickLine={false} width={36} />
            <Tooltip contentStyle={TOOLTIP} />
            {series.length > 1 ? <Legend wrapperStyle={LEGEND} /> : null}
            {series.map((s, i) => (
              <Line
                key={s.name}
                type="monotone"
                dataKey={s.name}
                stroke={SERIES[i % SERIES.length]}
                strokeWidth={2}
                dot={false}
              />
            ))}
          </LineChart>
        );
      case "area":
        return (
          <AreaChart data={data} margin={MARGIN}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="category" tick={TICK} axisLine={false} tickLine={false} />
            <YAxis tick={TICK} axisLine={false} tickLine={false} width={36} />
            <Tooltip contentStyle={TOOLTIP} />
            {series.length > 1 ? <Legend wrapperStyle={LEGEND} /> : null}
            {series.map((s, i) => (
              <Area
                key={s.name}
                type="monotone"
                dataKey={s.name}
                stroke={SERIES[i % SERIES.length]}
                fill={SERIES[i % SERIES.length]}
                fillOpacity={0.18}
                strokeWidth={2}
              />
            ))}
          </AreaChart>
        );
      default:
        return (
          <BarChart data={data} margin={MARGIN}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="category" tick={TICK} axisLine={false} tickLine={false} />
            <YAxis tick={TICK} axisLine={false} tickLine={false} width={36} />
            <Tooltip contentStyle={TOOLTIP} cursor={{ fill: "var(--muted)" }} />
            {series.length > 1 ? <Legend wrapperStyle={LEGEND} /> : null}
            {series.map((s, i) => (
              <Bar key={s.name} dataKey={s.name} fill={SERIES[i % SERIES.length]} radius={[4, 4, 0, 0]} />
            ))}
          </BarChart>
        );
    }
  })();

  return (
    <figure className="overflow-hidden rounded-md bg-background">
      {props.title ? (
        <figcaption className="border-b border-border bg-muted px-4 py-2.5 text-sm font-medium text-foreground">
          {props.title}
        </figcaption>
      ) : null}
      <div className="h-56 w-full px-2 pt-3 pb-1 text-xs">
        <ResponsiveContainer width="100%" height="100%">
          {chart}
        </ResponsiveContainer>
      </div>
      {props.caption ? (
        <p className="px-4 pb-3 text-xs text-muted-foreground">{props.caption}</p>
      ) : null}
    </figure>
  );
}

const MARGIN = { top: 8, right: 12, left: 0, bottom: 0 };
const TICK = { fontSize: 11, fill: "var(--muted-foreground)" };
const TOOLTIP = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  color: "var(--foreground)",
  fontSize: 12,
};
const LEGEND = { fontSize: 11 };

function SentLine({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md bg-background px-3.5 py-2.5 text-sm text-muted-foreground">
      <CheckCircle2 className="size-4 text-pill-success-ink" />
      {label}
    </div>
  );
}

/** Inline chat form over the house Field / Input / Textarea / NativeSelect / Checkbox. */
export function ChatUiForm({
  props,
}: {
  props: {
    title?: string;
    description?: string;
    submitLabel?: string;
    fields: ChatUiFormField[];
  };
}) {
  const send = useOptionalChatUiSend();
  const alreadySent = useChatUiSubmitted(props.title);
  const [values, setValues] = useState<Record<string, string | string[] | boolean>>({});
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const set = (id: string, value: string | string[] | boolean) =>
    setValues((v) => ({ ...v, [id]: value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!send || sending) return;
    setSending(true);
    try {
      await send(
        formatFormSubmission(
          props.title,
          props.fields.map((f) => {
            const raw = values[f.id];
            // Selects store option values; report the labels the person saw.
            const labelOf = (v: string) =>
              f.options?.find((o) => (o.value ?? o.label) === v)?.label ?? v;
            const value = Array.isArray(raw)
              ? raw.map(labelOf)
              : typeof raw === "string" && (f.type === "select" || f.type === "multiselect")
                ? labelOf(raw)
                : raw;
            return { label: f.label, value };
          }),
        ),
      );
      setSent(true);
    } finally {
      setSending(false);
    }
  };

  if (sent || alreadySent)
    return <SentLine label={`${props.title ? `${props.title} — ` : ""}answers sent`} />;

  const disabled = !send || sending;
  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-4 rounded-md bg-background px-4 py-3.5"
    >
      {props.title || props.description ? (
        <div className="flex flex-col gap-0.5">
          {props.title ? <p className="text-sm font-medium">{props.title}</p> : null}
          {props.description ? (
            <p className="text-xs text-muted-foreground">{props.description}</p>
          ) : null}
        </div>
      ) : null}
      <FieldGroup className="gap-3">
        {props.fields.map((f) => {
          const id = `chat-form-${f.id}`;
          const options = f.options ?? [];
          if (f.type === "checkbox") {
            return (
              <Field key={f.id} orientation="horizontal">
                <Checkbox
                  id={id}
                  checked={values[f.id] === true}
                  onCheckedChange={(checked) => set(f.id, checked === true)}
                  disabled={disabled}
                />
                <FieldLabel htmlFor={id} className="font-normal">
                  {f.label}
                </FieldLabel>
              </Field>
            );
          }
          if (f.type === "multiselect") {
            const chosen = Array.isArray(values[f.id]) ? (values[f.id] as string[]) : [];
            return (
              <Field key={f.id}>
                <FieldLabel>{f.label}</FieldLabel>
                <div className="flex flex-wrap gap-2">
                  {options.map((o) => {
                    const v = o.value ?? o.label;
                    const on = chosen.includes(v);
                    return (
                      <Button
                        key={v}
                        type="button"
                        size="sm"
                        variant={on ? "secondary" : "outline"}
                        aria-pressed={on}
                        disabled={disabled}
                        onClick={() => set(f.id, on ? chosen.filter((c) => c !== v) : [...chosen, v])}
                      >
                        {o.label}
                      </Button>
                    );
                  })}
                </div>
              </Field>
            );
          }
          return (
            <Field key={f.id}>
              <FieldLabel htmlFor={id}>
                {f.label}
                {f.required ? <span className="text-muted-foreground"> *</span> : null}
              </FieldLabel>
              {f.type === "textarea" ? (
                <Textarea
                  id={id}
                  rows={3}
                  required={f.required}
                  placeholder={f.placeholder}
                  disabled={disabled}
                  value={typeof values[f.id] === "string" ? (values[f.id] as string) : ""}
                  onChange={(e) => set(f.id, e.target.value)}
                />
              ) : f.type === "select" ? (
                <NativeSelect
                  id={id}
                  required={f.required}
                  disabled={disabled}
                  value={typeof values[f.id] === "string" ? (values[f.id] as string) : ""}
                  onChange={(e) => set(f.id, e.target.value)}
                >
                  <option value="">{f.placeholder ?? "Choose…"}</option>
                  {options.map((o) => (
                    <option key={o.value ?? o.label} value={o.value ?? o.label}>
                      {o.label}
                    </option>
                  ))}
                </NativeSelect>
              ) : (
                <Input
                  id={id}
                  type={f.type === "number" ? "number" : f.type === "date" ? "date" : f.type === "time" ? "time" : "text"}
                  required={f.required}
                  placeholder={f.placeholder}
                  disabled={disabled}
                  value={typeof values[f.id] === "string" ? (values[f.id] as string) : ""}
                  onChange={(e) => set(f.id, e.target.value)}
                />
              )}
              {f.placeholder && f.type === "date" ? (
                <FieldDescription>{f.placeholder}</FieldDescription>
              ) : null}
            </Field>
          );
        })}
      </FieldGroup>
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={disabled}>
          {props.submitLabel ?? "Send"}
        </Button>
      </div>
    </form>
  );
}

/** The shadcn/ui Questionnaire primitive over the catalog's questions. */
export function ChatUiQuestionnaire({
  props,
}: {
  props: { title?: string; questions: ChatUiQuestion[] };
}) {
  const send = useOptionalChatUiSend();
  const alreadySent = useChatUiSubmitted(props.title);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const items = useMemo(
    () =>
      props.questions.map((q) => ({
        name: q.id,
        required: q.required ?? false,
        multiple: q.multiple ?? false,
      })),
    [props.questions],
  );

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!send || sending) return;
    const fd = new FormData(e.currentTarget);
    setSending(true);
    try {
      await send(
        formatFormSubmission(
          props.title,
          props.questions.map((q) => {
            const raw = fd.getAll(q.id).map(String).filter(Boolean);
            const labels = raw.map(
              (v) => q.choices.find((c) => (c.value ?? c.label) === v)?.label ?? v,
            );
            return { label: q.prompt, value: labels };
          }),
        ),
      );
      setSent(true);
    } finally {
      setSending(false);
    }
  };

  if (sent || alreadySent)
    return <SentLine label={`${props.title ? `${props.title} — ` : ""}answers sent`} />;

  return (
    <div className={cn("rounded-md bg-background px-4 py-3.5", !send && "opacity-60")}>
      {props.title ? <p className="mb-3 text-sm font-medium">{props.title}</p> : null}
      <Questionnaire items={items} onSubmit={submit} shortcuts="letters">
        <QuestionnaireProgress />
        {props.questions.map((q) => (
          <QuestionnaireItem
            key={q.id}
            name={q.id}
            required={q.required ?? false}
            multiple={q.multiple ?? false}
            disabled={!send || sending}
          >
            <QuestionnaireTitle>{q.prompt}</QuestionnaireTitle>
            {q.description ? (
              <QuestionnaireDescription>{q.description}</QuestionnaireDescription>
            ) : null}
            <QuestionnaireChoices>
              {q.choices.map((c) => (
                <QuestionnaireChoice key={c.value ?? c.label} value={c.value ?? c.label}>
                  <span className="font-medium">{c.label}</span>
                  {c.description ? (
                    <QuestionnaireChoiceDescription>{c.description}</QuestionnaireChoiceDescription>
                  ) : null}
                </QuestionnaireChoice>
              ))}
              {q.allowOther ? (
                <QuestionnaireInput aria-label="Another answer" placeholder="Something else…" />
              ) : null}
            </QuestionnaireChoices>
            <QuestionnaireError />
          </QuestionnaireItem>
        ))}
        <QuestionnaireActions>
          <QuestionnairePrevious />
          <QuestionnaireSkip />
          <QuestionnaireNext />
          <QuestionnaireSubmit />
        </QuestionnaireActions>
      </Questionnaire>
    </div>
  );
}
