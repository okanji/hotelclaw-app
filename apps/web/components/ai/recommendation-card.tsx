"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * RecommendationCard — the house shape for "the AI thinks you should do X".
 *
 * A quiet card that holds its shape: header (title + optional description),
 * the recommended option, an optional segmented confidence meter, a quiet
 * "Why" disclosure over the deterministic evidence lines, an optional
 * "Alternatives" drawer that expands in place (picking one PROMOTES it to the
 * recommendation via `onPromote`), and an always-visible primary confirm CTA.
 *
 * Everything is tokens — no raw hex, sentence case throughout.
 */

export type RecommendationConfidence = {
  level: "high" | "medium" | "low";
  label: string;
};

export type RecommendationAlternative = {
  id: string;
  label: string;
  sublabel?: string;
};

export type RecommendationCardProps = {
  title: string;
  description?: string;
  confidence?: RecommendationConfidence;
  /** The currently recommended option. Omit when the title IS the recommendation. */
  recommended?: { label: string; sublabel?: string };
  /** Other valid options; picking one calls `onPromote` to make it the recommendation. */
  alternatives?: RecommendationAlternative[];
  onPromote?: (id: string) => void;
  /** Always-visible confirm. `href` renders a link (navigation CTA) instead of a button. */
  primaryCta: { label: string; onClick?: () => void; href?: string; busy?: boolean };
  secondaryCta?: { label: string; onClick: () => void };
  /** Deterministic evidence lines, shown in the quiet expandable "Why" disclosure. */
  basis?: string[];
  className?: string;
};

const METER_SEGMENTS: Record<RecommendationConfidence["level"], number> = {
  high: 3,
  medium: 2,
  low: 1,
};

const METER_TONE: Record<RecommendationConfidence["level"], string> = {
  high: "bg-success",
  medium: "bg-warning",
  low: "bg-muted-foreground",
};

function ConfidenceMeter({ level }: { level: RecommendationConfidence["level"] }) {
  const filled = METER_SEGMENTS[level];
  return (
    <span aria-hidden className="flex items-center gap-0.5">
      {[0, 1, 2].map((segment) => (
        <span
          key={segment}
          className={cn(
            "h-2.5 w-1 rounded-full transition-colors",
            segment < filled ? METER_TONE[level] : "bg-border",
          )}
        />
      ))}
    </span>
  );
}

export function RecommendationCard({
  title,
  description,
  confidence,
  recommended,
  alternatives,
  onPromote,
  primaryCta,
  secondaryCta,
  basis,
  className,
}: RecommendationCardProps) {
  const [alternativesOpen, setAlternativesOpen] = useState(false);
  const [whyOpen, setWhyOpen] = useState(false);

  const hasAlternatives = Boolean(alternatives && alternatives.length > 0 && onPromote);
  const hasBasis = Boolean(basis && basis.length > 0);

  return (
    <div className={cn("overflow-hidden rounded-card bg-card shadow-ring", className)}>
      <div className="px-3 pt-3 pb-2">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {description ? (
          <p className="mt-0.5 text-xs leading-relaxed text-pretty text-muted-foreground">
            {description}
          </p>
        ) : null}

        {recommended ? (
          // Keyed so a promoted alternative fades in as the new recommendation.
          <p key={recommended.label} className="ai-fade-up mt-1.5 text-sm">
            <span className="font-semibold text-foreground">{recommended.label}</span>
            {recommended.sublabel ? (
              <span className="ml-1.5 text-xs text-muted-foreground">
                {recommended.sublabel}
              </span>
            ) : null}
          </p>
        ) : null}

        {hasBasis ? (
          <>
            <button
              type="button"
              aria-expanded={whyOpen}
              onClick={() => setWhyOpen((current) => !current)}
              className="mt-1.5 inline-flex items-center gap-1 rounded-md text-xs text-faint-foreground transition-colors hover:text-foreground"
            >
              <ChevronRight
                aria-hidden
                className={cn("size-3 transition-transform", whyOpen && "rotate-90")}
              />
              Why
            </button>
            {whyOpen ? (
              <ul className="mt-1 flex flex-col gap-0.5">
                {basis?.map((line) => (
                  <li key={line} className="text-xs leading-relaxed text-muted-foreground">
                    · {line}
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : null}
      </div>

      {/* Alternatives drawer — a distinctly new section of the card that
          expands in place; picking an option promotes it. */}
      {hasAlternatives ? (
        <div
          className="grid transition-[grid-template-rows,opacity] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
          style={{
            gridTemplateRows: alternativesOpen ? "1fr" : "0fr",
            opacity: alternativesOpen ? 1 : 0,
          }}
        >
          <div className="overflow-hidden">
            <div className="border-t border-border px-2 py-2">
              <p className="px-1.5 pb-1 text-xs font-medium text-faint-foreground">
                Other options
              </p>
              {alternatives?.map((alternative) => (
                <button
                  key={alternative.id}
                  type="button"
                  onClick={() => onPromote?.(alternative.id)}
                  className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left transition-colors hover:bg-accent"
                >
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                    {alternative.label}
                  </span>
                  {alternative.sublabel ? (
                    <span className="shrink-0 text-xs text-faint-foreground">
                      {alternative.sublabel}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-3 px-3 pt-1 pb-3">
        {confidence ? (
          <span className="flex items-center gap-1.5">
            <ConfidenceMeter level={confidence.level} />
            <span className="text-xs font-medium text-muted-foreground">
              {confidence.label}
            </span>
          </span>
        ) : (
          <span />
        )}

        <span className="flex items-center gap-1.5">
          {hasAlternatives ? (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              aria-expanded={alternativesOpen}
              className="text-muted-foreground"
              onClick={() => setAlternativesOpen((current) => !current)}
            >
              Alternatives
            </Button>
          ) : null}
          {secondaryCta ? (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="text-muted-foreground"
              onClick={secondaryCta.onClick}
            >
              {secondaryCta.label}
            </Button>
          ) : null}
          {primaryCta.href ? (
            <Button
              size="xs"
              // Renders an <a>, so Base UI's native-button assertion is waived
              // — the house convention for every Button+Link call site.
              nativeButton={false}
              render={<Link href={primaryCta.href} />}
            >
              {primaryCta.label}
            </Button>
          ) : (
            <Button
              type="button"
              size="xs"
              disabled={primaryCta.busy}
              onClick={primaryCta.onClick}
            >
              {primaryCta.busy ? (
                <Loader2 className="size-3 animate-spin" aria-hidden />
              ) : null}
              {primaryCta.label}
            </Button>
          )}
        </span>
      </div>
    </div>
  );
}
