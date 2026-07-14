"use client";

import { useMemo } from "react";
import { NativeSelect } from "@/components/ui/native-select";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { WorkflowSpec } from "@/lib/workflows/spec";

/**
 * Friendly schedule builder for the trigger node. Non-technical users pick a
 * frequency + day(s) + time + timezone; we generate the 5-field cron string
 * under the hood. A "custom" frequency exposes the raw cron field for power
 * users. The stored shape ({ cron, timezone } / { at }) is unchanged.
 */
export function ScheduleTriggerConfig({
  trigger,
  onChange,
}: {
  trigger: WorkflowSpec["trigger"];
  onChange: (schedule: NonNullable<WorkflowSpec["trigger"]["schedule"]>) => void;
}) {
  const schedule = trigger.schedule ?? {};
  const isCron = trigger.event_type === "schedule.cron";
  const isAtTime = trigger.event_type === "schedule.at_time";

  const parsed = useMemo(() => parseCron(schedule.cron), [schedule.cron]);

  if (!isCron && !isAtTime) return null;

  function patch(next: Partial<NonNullable<WorkflowSpec["trigger"]["schedule"]>>) {
    onChange({ ...schedule, ...next });
  }

  function setParsed(next: Partial<ParsedCron>) {
    const merged = { ...parsed, ...next };
    patch({ cron: buildCron(merged) });
  }

  const timezone = schedule.timezone || localTimezone();

  return (
    <div className="space-y-4">
      {isCron ? (
        <>
          {/* Frequency */}
          <Field label="How often">
            <NativeSelect
              value={parsed.freq}
              onChange={(e) => setParsed(defaultsForFreq(e.target.value as Freq, parsed))}
              className="h-9"
            >
              <option value="hourly">Every hour</option>
              <option value="daily">Every day</option>
              <option value="weekly">Every week</option>
              <option value="monthly">Every month</option>
              <option value="custom">Custom…</option>
            </NativeSelect>
          </Field>

          {/* Weekly: which days */}
          {parsed.freq === "weekly" ? (
            <Field label="On these days">
              <div className="flex flex-wrap gap-1.5">
                {DAY_LABELS.map((d, i) => {
                  const on = parsed.dows.includes(i);
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => {
                        const dows = on
                          ? parsed.dows.filter((x) => x !== i)
                          : [...parsed.dows, i].sort((a, b) => a - b);
                        setParsed({ dows: dows.length ? dows : [i] });
                      }}
                      className={cn(
                        "h-8 w-10 rounded-md border text-sm font-medium transition-colors",
                        on
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-input text-muted-foreground hover:bg-muted",
                      )}
                    >
                      {d}
                    </button>
                  );
                })}
              </div>
            </Field>
          ) : null}

          {/* Monthly: which day of month */}
          {parsed.freq === "monthly" ? (
            <Field label="On day of the month">
              <NativeSelect
                value={parsed.dom}
                onChange={(e) => setParsed({ dom: Number(e.target.value) })}
                className="h-9"
              >
                {Array.from({ length: 28 }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    {ordinal(n)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          ) : null}

          {/* Time of day (not for hourly/custom) */}
          {parsed.freq === "daily" ||
          parsed.freq === "weekly" ||
          parsed.freq === "monthly" ? (
            <Field label="At">
              <Input
                type="time"
                value={`${pad(parsed.hour)}:${pad(parsed.minute)}`}
                onChange={(e) => {
                  const [h, m] = e.target.value.split(":");
                  setParsed({ hour: Number(h) || 0, minute: Number(m) || 0 });
                }}
                className="text-sm"
              />
            </Field>
          ) : null}

          {/* Hourly: at which minute */}
          {parsed.freq === "hourly" ? (
            <Field label="At minute">
              <NativeSelect
                value={parsed.minute}
                onChange={(e) => setParsed({ minute: Number(e.target.value) })}
                className="h-9"
              >
                {[0, 5, 10, 15, 20, 30, 45].map((n) => (
                  <option key={n} value={n}>
                    {n === 0 ? "on the hour" : `${n} minutes past`}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          ) : null}

          {/* Custom raw cron */}
          {parsed.freq === "custom" ? (
            <Field label="Schedule pattern (cron)">
              <Input
                value={schedule.cron ?? ""}
                onChange={(e) => patch({ cron: e.target.value || undefined })}
                placeholder="0 9 * * 1"
                className="font-mono text-sm"
              />
              <Hint>
                Advanced: standard 5-field cron, e.g.{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-xs">0 9 * * 1</code>{" "}
                for Mondays at 9:00.
              </Hint>
            </Field>
          ) : null}

          {/* Timezone */}
          <Field label="Timezone">
            <NativeSelect
              value={timezone}
              onChange={(e) => patch({ timezone: e.target.value })}
              className="h-9"
            >
              {timezoneOptions(timezone).map((tz) => (
                <option key={tz} value={tz}>
                  {tz.replace(/_/g, " ")}
                </option>
              ))}
            </NativeSelect>
          </Field>

          {/* Plain-English preview */}
          {parsed.freq !== "custom" ? (
            <p className="rounded-md bg-muted/40 px-3 py-2 text-sm text-foreground/85">
              Runs {describeSchedule(parsed)}{" "}
              <span className="text-muted-foreground">({timezone.replace(/_/g, " ")})</span>.
            </p>
          ) : null}
        </>
      ) : null}

      {isAtTime ? (
        <Field label="Run once on">
          <Input
            id="trigger-schedule-at"
            type="datetime-local"
            value={isoToLocalInput(schedule.at)}
            onChange={(e) => patch({ at: localInputToIso(e.target.value) })}
            className="text-sm"
          />
          <Hint>The workflow runs a single time, at this date and time.</Hint>
        </Field>
      ) : null}
    </div>
  );
}

// ─── Small layout helpers ─────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium text-foreground/80">{label}</span>
      {children}
    </label>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <span className="block text-xs leading-relaxed text-muted-foreground">{children}</span>;
}

// ─── Cron parse / build ───────────────────────────────────────────────────────

type Freq = "hourly" | "daily" | "weekly" | "monthly" | "custom";

interface ParsedCron {
  freq: Freq;
  minute: number;
  hour: number;
  /** 0 = Sunday … 6 = Saturday */
  dows: number[];
  /** day of month, 1–28 */
  dom: number;
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const DEFAULTS: ParsedCron = { freq: "daily", minute: 0, hour: 9, dows: [1], dom: 1 };

function defaultsForFreq(freq: Freq, prev: ParsedCron): ParsedCron {
  return { ...prev, freq };
}

/** Best-effort parse of a 5-field cron into the builder model; falls back to custom. */
function parseCron(cron?: string): ParsedCron {
  if (!cron || !cron.trim()) return { ...DEFAULTS };
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return { ...DEFAULTS, freq: "custom" };
  const [m, h, dom, mon, dow] = parts;

  const minute = numeric(m);
  const hour = numeric(h);

  // Anything that pins a month is beyond the simple builder — use raw cron.
  if (mon !== "*") return { ...DEFAULTS, freq: "custom" };

  // Hourly: minute fixed, hour wildcard.
  if (h === "*" && minute != null && dom === "*" && dow === "*") {
    return { ...DEFAULTS, freq: "hourly", minute };
  }
  if (minute == null || hour == null) return { ...DEFAULTS, freq: "custom" };

  // Monthly: specific day of month.
  if (dom !== "*" && dow === "*") {
    const d = numeric(dom);
    if (d == null || d < 1 || d > 28) return { ...DEFAULTS, freq: "custom" };
    return { ...DEFAULTS, freq: "monthly", minute, hour, dom: d };
  }

  // Weekly: specific day(s) of week.
  if (dow !== "*" && dom === "*") {
    const dows = dow
      .split(",")
      .map((x) => numeric(x))
      .filter((x): x is number => x != null)
      .map((x) => (x === 7 ? 0 : x))
      .filter((x) => x >= 0 && x <= 6);
    if (dows.length === 0) return { ...DEFAULTS, freq: "custom" };
    return { ...DEFAULTS, freq: "weekly", minute, hour, dows };
  }

  // Daily: every day at a time.
  if (dom === "*" && dow === "*") {
    return { ...DEFAULTS, freq: "daily", minute, hour };
  }

  return { ...DEFAULTS, freq: "custom" };
}

function buildCron(p: ParsedCron): string {
  switch (p.freq) {
    case "hourly":
      return `${p.minute} * * * *`;
    case "daily":
      return `${p.minute} ${p.hour} * * *`;
    case "weekly": {
      const dows = p.dows.length ? [...p.dows].sort((a, b) => a - b).join(",") : "1";
      return `${p.minute} ${p.hour} * * ${dows}`;
    }
    case "monthly":
      return `${p.minute} ${p.hour} ${p.dom} * *`;
    default:
      return `${p.minute} ${p.hour} * * *`;
  }
}

function numeric(token: string): number | null {
  if (!/^\d+$/.test(token)) return null;
  return Number(token);
}

// ─── Plain-English description ────────────────────────────────────────────────

function describeSchedule(p: ParsedCron): string {
  const time = formatTime(p.hour, p.minute);
  switch (p.freq) {
    case "hourly":
      return p.minute === 0 ? "every hour, on the hour" : `every hour at ${p.minute} minutes past`;
    case "daily":
      return `every day at ${time}`;
    case "weekly": {
      const days = [...p.dows].sort((a, b) => a - b).map((d) => FULL_DAYS[d]);
      return `every ${joinList(days)} at ${time}`;
    }
    case "monthly":
      return `on the ${ordinal(p.dom)} of each month at ${time}`;
    default:
      return "on a custom schedule";
  }
}

const FULL_DAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function formatTime(hour: number, minute: number): string {
  const period = hour < 12 ? "AM" : "PM";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${pad(minute)} ${period}`;
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

// ─── Timezone helpers ─────────────────────────────────────────────────────────

function localTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

const FALLBACK_ZONES = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Toronto",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Asia/Dubai",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
];

function timezoneOptions(current: string): string[] {
  let zones: string[];
  try {
    const supported = (
      Intl as unknown as { supportedValuesOf?: (k: string) => string[] }
    ).supportedValuesOf?.("timeZone");
    zones = supported && supported.length ? supported : FALLBACK_ZONES;
  } catch {
    zones = FALLBACK_ZONES;
  }
  // Ensure the current value is selectable even if the runtime omits it.
  return zones.includes(current) ? zones : [current, ...zones];
}

// ─── One-shot datetime helpers (unchanged) ────────────────────────────────────

function isoToLocalInput(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localInputToIso(value: string): string | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString();
}
