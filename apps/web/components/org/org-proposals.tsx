"use client";

import { useMemo, useState, useTransition } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { queryOptions } from "@tanstack/react-query";
import { Check, GitPullRequestArrow, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { createClient } from "@/lib/supabase/client";
import type { OrgChart } from "@/lib/org/queries";
import { decideOrgProposal, proposeOrgChange } from "./proposal-actions";

/**
 * D1 — the HR proposal queue on the org chart. Anyone proposes ("we hired a
 * new head of housekeeping"); owners approve, which applies the change
 * through the org editor's own writers — and because workflows can reference
 * roles ({{org.title.*}} / {{org.lead.*}}), everything downstream follows.
 */

type ProposalKind =
  | "set_title"
  | "set_manager"
  | "set_home_team"
  | "set_team_lead";

type ProposalRow = {
  id: string;
  kind: ProposalKind;
  subject_user_id: string | null;
  subject_space_id: string | null;
  new_text: string | null;
  new_id: string | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
};

const KIND_LABELS: Record<ProposalKind, string> = {
  set_title: "Change someone's title",
  set_manager: "Change who someone reports to",
  set_home_team: "Move someone to another team",
  set_team_lead: "Change a team's lead",
};

function proposalsQueryOptions(propertyId: string) {
  return queryOptions({
    queryKey: ["org-proposals", propertyId] as const,
    queryFn: async (): Promise<ProposalRow[]> => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("org_change_proposals")
        .select(
          "id, kind, subject_user_id, subject_space_id, new_text, new_id, note, created_by, created_at",
        )
        .eq("property_id", propertyId)
        .eq("status", "pending")
        .order("created_at", { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as ProposalRow[];
    },
    staleTime: 30_000,
  });
}

function myRoleQueryOptions(propertyId: string) {
  return queryOptions({
    queryKey: ["my-org-role", propertyId] as const,
    queryFn: async (): Promise<string | null> => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return null;
      const { data } = await supabase
        .from("memberships")
        .select("role")
        .eq("property_id", propertyId)
        .eq("user_id", user.id)
        .maybeSingle();
      return data?.role ?? null;
    },
    staleTime: 10 * 60_000,
  });
}

export function OrgProposals({
  propertyId,
  org,
}: {
  propertyId: string;
  org: OrgChart;
}) {
  const queryClient = useQueryClient();
  const { data: proposals = [] } = useQuery(proposalsQueryOptions(propertyId));
  const { data: myRole } = useQuery(myRoleQueryOptions(propertyId));
  const isOwner = myRole === "owner";
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const personName = (id: string | null) =>
    org.people.find((p) => p.id === id)?.name ?? "someone";
  const teamName = (id: string | null) =>
    org.teams.find((t) => t.id === id)?.name ?? "a team";

  const describe = (p: ProposalRow): string => {
    switch (p.kind) {
      case "set_title":
        return `${personName(p.subject_user_id)} → title "${p.new_text}"`;
      case "set_manager":
        return `${personName(p.subject_user_id)} → reports to ${personName(p.new_id)}`;
      case "set_home_team":
        return `${personName(p.subject_user_id)} → home team ${teamName(p.new_id)}`;
      case "set_team_lead":
        return `${teamName(p.subject_space_id)} → led by ${personName(p.new_id)}`;
    }
  };

  function decide(proposalId: string, approve: boolean) {
    startTransition(async () => {
      const res = await decideOrgProposal({ propertyId, proposalId, approve });
      if ("error" in res) toast.error(res.error);
      else toast.success(approve ? "Applied to the org chart" : "Rejected");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["org-proposals", propertyId] }),
        queryClient.invalidateQueries({ queryKey: ["org-chart", propertyId] }),
      ]);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {proposals.length > 0 ? (
        <div className="flex flex-col gap-1.5 rounded-md bg-muted p-4">
          <p className="text-sm font-medium text-foreground">
            Proposed changes
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {isOwner ? "your approval applies them" : "waiting for an owner"}
            </span>
          </p>
          <ul className="flex flex-col divide-y divide-border">
            {proposals.map((p) => (
              <li key={p.id} className="flex items-center gap-3 py-2">
                <GitPullRequestArrow className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-foreground">
                    {describe(p)}
                  </p>
                  <p className="truncate text-xs text-faint-foreground">
                    Proposed by {personName(p.created_by)}
                    {p.note ? ` — ${p.note}` : ""}
                  </p>
                </div>
                {isOwner ? (
                  <span className="flex shrink-0 items-center gap-1">
                    <Button
                      type="button"
                      size="sm"
                      className="h-7 text-xs"
                      disabled={pending}
                      onClick={() => decide(p.id, true)}
                    >
                      <Check className="size-3.5" />
                      Approve
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs text-faint-foreground"
                      disabled={pending}
                      onClick={() => decide(p.id, false)}
                    >
                      <X className="size-3.5" />
                    </Button>
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <Button
        type="button"
        size="sm"
        variant="outline"
        className="w-fit"
        onClick={() => setDialogOpen(true)}
      >
        <GitPullRequestArrow className="size-4" />
        Propose a change
      </Button>

      <ProposeDialog
        propertyId={propertyId}
        org={org}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onCreated={() =>
          void queryClient.invalidateQueries({
            queryKey: ["org-proposals", propertyId],
          })
        }
      />
    </div>
  );
}

/* ── Propose dialog ──────────────────────────────────────────────────────── */

function ProposeDialog({
  propertyId,
  org,
  open,
  onOpenChange,
  onCreated,
}: {
  propertyId: string;
  org: OrgChart;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const [kind, setKind] = useState<ProposalKind>("set_title");
  const [subjectUserId, setSubjectUserId] = useState("");
  const [subjectSpaceId, setSubjectSpaceId] = useState("");
  const [newText, setNewText] = useState("");
  const [newId, setNewId] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const needsPerson = kind !== "set_team_lead";
  const needsTeamSubject = kind === "set_team_lead";
  const needsPersonValue = kind === "set_manager" || kind === "set_team_lead";
  const needsTeamValue = kind === "set_home_team";
  const needsText = kind === "set_title";

  const valid =
    (!needsPerson || subjectUserId) &&
    (!needsTeamSubject || subjectSpaceId) &&
    (!needsPersonValue || newId) &&
    (!needsTeamValue || newId) &&
    (!needsText || newText.trim());

  const sortedPeople = useMemo(
    () =>
      [...org.people].sort((a, b) =>
        (a.name ?? "").localeCompare(b.name ?? ""),
      ),
    [org.people],
  );

  async function submit() {
    if (!valid || busy) return;
    setBusy(true);
    try {
      const res = await proposeOrgChange({
        propertyId,
        kind,
        subjectUserId: needsPerson ? subjectUserId : null,
        subjectSpaceId: needsTeamSubject ? subjectSpaceId : null,
        newText: needsText ? newText.trim() : null,
        newId: needsPersonValue || needsTeamValue ? newId : null,
        note: note.trim() || undefined,
      });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success("Proposed — an owner will review it");
      setNewText("");
      setNote("");
      onOpenChange(false);
      onCreated();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Propose an org change</DialogTitle>
          <DialogDescription>
            An owner reviews and applies it — workflows that reference roles
            update automatically.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <NativeSelect
            value={kind}
            onChange={(e) => setKind(e.target.value as ProposalKind)}
            aria-label="Change type"
          >
            {(Object.keys(KIND_LABELS) as ProposalKind[]).map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </NativeSelect>

          {needsPerson ? (
            <NativeSelect
              value={subjectUserId}
              onChange={(e) => setSubjectUserId(e.target.value)}
              aria-label="Person"
            >
              <option value="">Who?</option>
              {sortedPeople.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name ?? "Unnamed"}
                </option>
              ))}
            </NativeSelect>
          ) : null}

          {needsTeamSubject ? (
            <NativeSelect
              value={subjectSpaceId}
              onChange={(e) => setSubjectSpaceId(e.target.value)}
              aria-label="Team"
            >
              <option value="">Which team?</option>
              {org.teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </NativeSelect>
          ) : null}

          {needsText ? (
            <Input
              value={newText}
              onChange={(e) => setNewText(e.target.value)}
              placeholder="New title — e.g. Head of Housekeeping"
              maxLength={80}
            />
          ) : null}

          {needsPersonValue ? (
            <NativeSelect
              value={newId}
              onChange={(e) => setNewId(e.target.value)}
              aria-label={kind === "set_manager" ? "New manager" : "New lead"}
            >
              <option value="">
                {kind === "set_manager" ? "Reports to…" : "New lead…"}
              </option>
              {sortedPeople.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name ?? "Unnamed"}
                </option>
              ))}
            </NativeSelect>
          ) : null}

          {needsTeamValue ? (
            <NativeSelect
              value={newId}
              onChange={(e) => setNewId(e.target.value)}
              aria-label="New home team"
            >
              <option value="">Team…</option>
              {org.teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </NativeSelect>
          ) : null}

          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Why? (optional — e.g. new hire starting Monday)"
            maxLength={500}
          />
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void submit()}
            disabled={busy || !valid}
          >
            Propose
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
