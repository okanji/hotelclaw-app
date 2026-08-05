"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Inbox, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SectionHeader } from "@/components/ui/section-header";
import { EmptyState } from "@/components/ui/empty-state";
import {
  fleetSessionsQueryOptions,
  type FleetSessionRow,
} from "@/lib/query/fleet-queries";
import { podBotEmoji, podToolInfo } from "@/lib/fleet/tool-catalog";
import { decideApproval } from "./actions";

/**
 * Approvals inbox. Rows come straight from bot_chat_sessions
 * (status='awaiting_approval' + the parked requests payload stamped by the
 * runtime); Realtime invalidation in AgentsSection keeps the list live, so
 * a decision made in chat removes the row here too.
 */
export function ApprovalsView({
  propertyId,
  canDecide,
}: {
  propertyId: string;
  canDecide: boolean;
}) {
  const qc = useQueryClient();
  const { data: sessions = [] } = useQuery(
    fleetSessionsQueryOptions(propertyId),
  );
  const pending = sessions.filter((s) => s.status === "awaiting_approval");

  return (
    <div className="mx-auto flex h-full w-full max-w-4xl flex-col overflow-y-auto px-8 pt-12 pb-16 sm:px-14 sm:pt-16">
      <SectionHeader
        size="page"
        eyebrow="Fleet"
        eyebrowTone="brand"
        title="Approvals"
        description="Money-moving actions the bots have parked for a human decision. Nothing executes until someone approves — here, or by replying to the bot in its channel."
      />

      {/* Masthead and content separate by WHITESPACE. The full-width rule
          that used to sit here read as a seam under a 720px document
          column (notion-spec-v2 §1/§3). */}
      <div className="h-10" />

      {pending.length === 0 ? (
        <EmptyState icon={ShieldCheck} title="Nothing waiting on you">
          When a bot hits a gated action (refunds, rate overrides, comps), it
          parks the request and it shows up here.
        </EmptyState>
      ) : (
        <ul role="list" className="flex flex-col gap-4">
          {pending.map((session) => (
            <ApprovalCard
              key={session.id}
              propertyId={propertyId}
              session={session}
              canDecide={canDecide}
              onDecided={() =>
                void qc.invalidateQueries({
                  queryKey: ["fleet-sessions", propertyId],
                })
              }
            />
          ))}
        </ul>
      )}

      {!canDecide && pending.length > 0 ? (
        <p className="mt-6 text-xs text-muted-foreground">
          Only owners and managers can decide approvals.
        </p>
      ) : null}
    </div>
  );
}

function ApprovalCard({
  propertyId,
  session,
  canDecide,
  onDecided,
}: {
  propertyId: string;
  session: FleetSessionRow;
  canDecide: boolean;
  onDecided: () => void;
}) {
  const [busy, setBusy] = useState<"approve" | "deny" | null>(null);
  const requests = session.pending_approval?.requests ?? [];
  const requestedAt = session.pending_approval?.requestedAt;
  const isWorkflow = session.channel_id.startsWith("workflow:");

  async function decide(decision: "approve" | "deny") {
    setBusy(decision);
    try {
      const result = await decideApproval({
        propertyId,
        sessionRowId: session.id,
        decision,
      });
      if ("error" in result) {
        toast.error(result.error);
      } else {
        toast.success(
          decision === "approve" ? "Approved — the bot is proceeding" : "Denied",
        );
      }
      onDecided();
    } finally {
      setBusy(null);
    }
  }

  return (
    <li className="flex flex-col gap-3 rounded-card bg-warning/10 p-4">
      <div className="flex items-center gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-background text-sm">
          {podBotEmoji(session.bot?.bot_id ?? "")}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">
            {session.bot?.display_name ?? "Bot"}
          </p>
          <p className="truncate font-mono text-xs text-muted-foreground">
            {isWorkflow ? "workflow run" : session.channel_id}
            {requestedAt
              ? ` · ${new Date(requestedAt).toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}`
              : ""}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        {(requests.length ? requests : [{ toolName: "pending action", input: null }]).map(
          (request, index) => {
            const info = request.toolName ? podToolInfo(request.toolName) : null;
            return (
              <div
                key={index}
                className="flex flex-col gap-1 rounded-md bg-background px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  <code className="font-mono text-xs font-medium">
                    {request.toolName}
                  </code>
                  {info ? (
                    <span className="text-xs text-muted-foreground">
                      {info.label}
                    </span>
                  ) : null}
                </div>
                {request.input != null ? (
                  <pre className="max-h-32 overflow-auto rounded-md bg-muted p-2 font-mono text-xs leading-snug">
                    {JSON.stringify(request.input, null, 2)}
                  </pre>
                ) : null}
              </div>
            );
          },
        )}
      </div>

      {canDecide ? (
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={() => decide("approve")}
            disabled={busy !== null}
          >
            {busy === "approve" ? "Approving…" : "Approve"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => decide("deny")}
            disabled={busy !== null}
          >
            {busy === "deny" ? "Denying…" : "Deny"}
          </Button>
          <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
            <Inbox className="size-3.5" />
            Parked until decided — restarts included
          </span>
        </div>
      ) : null}
    </li>
  );
}
