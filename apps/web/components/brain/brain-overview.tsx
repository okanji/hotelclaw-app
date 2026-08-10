"use client";

import { useState, useTransition } from "react";
import { Brain, Sparkles, FileText, Clock, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/eyebrow";
import { StatGroup, Stat } from "@/components/ui/stat";
import { StatusBadge } from "@/components/ui/status-badge";
import { PageShell } from "@/components/ui/page-shell";
import { cn } from "@/lib/utils";
import type { BrainOverview } from "@/lib/brain/shared";
import { provisionBrainAction } from "./actions";

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - Date.parse(iso);
  if (Number.isNaN(ms)) return "never";
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

const KIND_LABEL: Record<BrainOverview["status"]["kind"], string> = {
  per_property: "Provisioned",
  pod: "Pod-inherited",
  none: "No brain yet",
};

/**
 * The Brain overview — the insight strip that fills the right pane when no
 * page is selected (and the whole surface when the property is brainless).
 * Makes the black box legible: is there a brain, is it reachable, what does
 * it know, are the docs mirrored, what did it learn lately — plus the
 * owner's one-click "Provision now".
 */
export function BrainOverview({
  propertyId,
  overview,
  isOwner,
  onSelectSlug,
}: {
  propertyId: string;
  overview: BrainOverview;
  isOwner: boolean;
  onSelectSlug: (slug: string) => void;
}) {
  const {
    status,
    health,
    healthReachable,
    bindingOk,
    docCoverage,
    knowledge,
    recent,
  } = overview;
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // A binding that exists but cannot answer. Distinct from "no brain yet"
  // (nothing to repair) and from "serve down" (nothing WE can fix) — this
  // one is the property's own OAuth client, and re-provisioning fixes it.
  const bindingBroken = bindingOk === false && healthReachable;

  const provision = (repair = false) => {
    setError(null);
    startTransition(async () => {
      const res = await provisionBrainAction(propertyId, { repair });
      if ("error" in res) setError(res.error);
      // Success revalidates the route server-side; the page re-renders with
      // the new binding, so no client state to flip here.
    });
  };

  const statusTone =
    status.kind === "none"
      ? "warning"
      : bindingOk === false
        ? "danger"
        : status.kind === "pod" && status.podStatus !== "active"
          ? "warning"
          : "success";

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto p-6">
      {/* The layout wrapper is INSIDE PageShell on purpose: PageShell puts
          `className` on its outer box but renders children inside a separate
          max-width measure div, so `flex flex-col gap-8` passed to PageShell
          lands on a parent whose only child is that measure — the gap never
          reaches these sections, and "Knowledge map" collided with the
          document-mirror paragraph above it. */}
      <PageShell>
        <div className="flex flex-col gap-8">
      {/* Status + health */}
      <section className="rounded-md bg-card p-5">
        <div className="flex flex-wrap items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted">
            <Brain className="size-5 text-muted-foreground" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold">
                Knowledge brain
              </h2>
              <StatusBadge tone={statusTone}>
                {bindingOk === false ? "Binding broken" : KIND_LABEL[status.kind]}
              </StatusBadge>
              {status.kind !== "none" ? (
                <StatusBadge tone={healthReachable ? "success" : "danger"} dot>
                  {healthReachable
                    ? `Server online${health.version ? ` · v${health.version}` : ""}`
                    : "Server unreachable"}
                </StatusBadge>
              ) : null}
            </div>
            <p className="mt-1 text-sm text-pretty text-muted-foreground">
              {bindingOk === false
                ? healthReachable
                  ? "The knowledge server is up, but this property's credential was rejected — so every bot here is currently running without the brain. Re-provisioning mints a fresh credential against the same source; nothing already captured is lost."
                  : "The knowledge server is not answering. Captures and searches fail until it recovers; nothing already captured is lost."
                : null}
              {bindingOk !== false && status.kind === "per_property" &&
                `This property writes to its own isolated source. Provisioned ${timeAgo(status.provisionedAt)}.`}
              {bindingOk !== false && status.kind === "pod" &&
                "This property inherits its pod client's shared brain — captures compound with the pod's knowledge."}
              {status.kind === "none" &&
                "Nothing is captured yet. Provisioning binds the property to its own isolated source so meetings, guest details, documents, and captured evidence become searchable memory."}
            </p>

            {bindingBroken && isOwner ? (
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <Button
                  size="sm"
                  onClick={() => provision(true)}
                  disabled={
                    pending || status.kind !== "per_property" || !status.transport
                  }
                >
                  <Sparkles className="size-4" />
                  {pending ? "Repairing…" : "Repair binding"}
                </Button>
                <span className="text-xs text-muted-foreground">
                  {status.kind !== "per_property"
                    ? "Pod bindings are repaired on the client, not here."
                    : !status.transport
                      ? "Provisioning isn't configured on this host."
                      : "Mints a new credential on the same source."}
                </span>
                {error ? (
                  <span className="text-xs text-destructive">{error}</span>
                ) : null}
              </div>
            ) : null}
            {bindingBroken && !isOwner ? (
              <p className="mt-3 text-xs text-muted-foreground">
                Ask an owner to repair the brain binding for this property.
              </p>
            ) : null}
            {status.source ? (
              <p className="mt-2 font-mono text-xs text-muted-foreground">
                {status.source}
                {health.engine ? ` · ${health.engine}` : ""}
              </p>
            ) : null}

            {status.kind === "none" && isOwner ? (
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <Button
                  size="sm"
                  onClick={() => provision()}
                  disabled={pending || !status.canProvision}
                >
                  <Sparkles className="size-4" />
                  {pending ? "Provisioning…" : "Provision now"}
                </Button>
                {!status.canProvision ? (
                  <span className="text-xs text-muted-foreground">
                    Provisioning isn&apos;t configured on this host yet.
                  </span>
                ) : status.transport === "http" ? (
                  <span className="text-xs text-muted-foreground">
                    Mints an isolated source + credential over the shared server.
                  </span>
                ) : null}
                {error ? (
                  <span className="text-xs text-destructive">{error}</span>
                ) : null}
              </div>
            ) : null}
            {status.kind === "none" && !isOwner ? (
              <p className="mt-3 text-xs text-muted-foreground">
                Ask an owner to provision the brain for this property.
              </p>
            ) : null}
          </div>
        </div>
      </section>

      {/* Document mirror coverage — from the app's own data, always shown */}
      <section className="flex flex-col gap-3">
        <Eyebrow>Document mirror</Eyebrow>
        <StatGroup cols={3}>
          <Stat label="Active documents" value={docCoverage.total} />
          <Stat
            label="Mirrored"
            value={docCoverage.synced}
            tone={docCoverage.total > 0 && docCoverage.synced === 0 ? "warning" : "neutral"}
          />
          <Stat
            label="Awaiting sync"
            value={docCoverage.stale}
            tone={docCoverage.stale > 0 ? "warning" : "success"}
            delta={docCoverage.lastSyncAt ? `last ${timeAgo(docCoverage.lastSyncAt)}` : undefined}
          />
        </StatGroup>
        <p className="text-sm text-pretty text-muted-foreground">
          {status.kind === "none"
            ? `${docCoverage.total} document${docCoverage.total === 1 ? "" : "s"} will mirror into the brain once it's provisioned.`
            : docCoverage.stale > 0
              ? "Stale docs re-mirror on edit and nightly — the bot may not yet see the newest changes."
              : "Every active document is mirrored — the bot answers from current docs."}
          {docCoverage.approximate ? " (sampled)" : ""}
        </p>
      </section>

      {/* Knowledge map + recent captures — only meaningful with a binding */}
      {status.kind !== "none" ? (
        <div className="grid gap-8 sm:grid-cols-2">
          <section className="flex flex-col gap-3">
            <Eyebrow>Knowledge map</Eyebrow>
            {bindingOk === false ? (
              // Never claim an empty brain we could not read — that is exactly
              // how a revoked credential passed for a fresh, empty one.
              <p className="text-sm text-pretty text-muted-foreground">
                Can&apos;t read the brain right now, so what it knows is
                unknown — not empty.
              </p>
            ) : knowledge.total === 0 ? (
              <p className="text-sm text-pretty text-muted-foreground">
                Nothing captured yet. Pages appear as meetings are summarized,
                guests share details, and bots capture evidence.
              </p>
            ) : (
              <ul role="list" className="flex flex-col gap-1.5">
                {knowledge.namespaces.map(({ namespace, count }) => (
                  <li
                    key={namespace}
                    className="flex items-center justify-between gap-3 text-sm"
                  >
                    <span className="truncate font-mono text-xs text-muted-foreground">
                      {namespace}/
                    </span>
                    <span className="tabular-nums text-muted-foreground">{count}</span>
                  </li>
                ))}
                <li className="mt-1 flex items-center justify-between gap-3 border-t border-border pt-2 text-sm font-medium">
                  <span>Total pages</span>
                  <span className="tabular-nums">{knowledge.total}</span>
                </li>
              </ul>
            )}
          </section>

          <section className="flex flex-col gap-3">
            <Eyebrow>Recently learned</Eyebrow>
            {recent.length === 0 ? (
              <p className="text-sm text-muted-foreground">No pages yet.</p>
            ) : (
              <ul role="list" className="flex flex-col gap-1">
                {recent.map((page) => (
                  <li key={page.slug}>
                    <button
                      type="button"
                      onClick={() => onSelectSlug(page.slug)}
                      className={cn(
                        "group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
                        "text-muted-foreground hover:bg-accent",
                      )}
                    >
                      <FileText className="size-3.5 shrink-0 text-muted-foreground/70" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-foreground">
                          {page.title}
                        </span>
                        <span className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                          <Clock className="size-3" />
                          {timeAgo(page.updated_at)}
                        </span>
                      </span>
                      <ArrowRight className="size-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      ) : null}

      {status.kind !== "none" ? (
        <p className="text-sm text-pretty text-muted-foreground">
          Use the search box on the left to preview exactly what a bot
          retrieves for any question — an empty result means the fact was
          never captured.
        </p>
      ) : null}
        </div>
      </PageShell>
    </div>
  );
}
