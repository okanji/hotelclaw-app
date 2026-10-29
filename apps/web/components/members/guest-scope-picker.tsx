"use client";

import { useEffect, useMemo, useState } from "react";
import { FileText, Hash, List as ListIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Chip } from "@/components/ui/chip";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import type { ScopeGrant, ScopeKind } from "@/lib/db/types";
import { listShareTargets } from "@/lib/guests/actions";

type Targets = {
  spaces: { id: string; name: string }[];
  lists: { id: string; name: string; space_id: string | null }[];
  documents: { id: string; title: string }[];
};

/**
 * What a guest (0118) gets to see — teams, lists, documents — plus one
 * "Can edit" switch for the whole selection. A team covers its lists, tasks,
 * docs and channels; a list covers its tasks. Used by the invite dialog and
 * the guest access dialog. Tasks and channels are granted from their own
 * pages / the access dialog, not here.
 */
export function GuestScopePicker({
  propertyId,
  value,
  onChange,
  disabled,
}: {
  propertyId: string;
  value: ScopeGrant[];
  onChange: (next: ScopeGrant[]) => void;
  disabled?: boolean;
}) {
  const [targets, setTargets] = useState<Targets | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    let cancelled = false;
    void listShareTargets(propertyId).then((res) => {
      if (cancelled) return;
      if ("error" in res) setError(res.error);
      else setTargets(res);
    });
    return () => {
      cancelled = true;
    };
  }, [propertyId]);

  const canEdit = value.length > 0 && value.every((v) => v.can_edit);
  const has = (kind: ScopeKind, id: string) => value.some((v) => v.kind === kind && v.id === id);
  const toggle = (kind: ScopeKind, id: string) =>
    onChange(
      has(kind, id)
        ? value.filter((v) => !(v.kind === kind && v.id === id))
        : [...value, { kind, id, can_edit: canEdit }],
    );

  const needle = q.trim().toLowerCase();
  const match = (s: string) => !needle || s.toLowerCase().includes(needle);
  const spaceName = useMemo(
    () => new Map((targets?.spaces ?? []).map((s) => [s.id, s.name] as const)),
    [targets],
  );

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!targets) return <p className="text-sm text-muted-foreground">Loading what you can share…</p>;

  const group = (
    title: string,
    kind: ScopeKind,
    rows: { id: string; label: string; hint?: string }[],
    Icon: typeof Hash,
  ) =>
    rows.length === 0 ? null : (
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-faint-foreground">{title}</p>
        <div className="flex flex-wrap gap-1">
          {rows.map((r) => (
            <Chip
              key={r.id}
              size="sm"
              selected={has(kind, r.id)}
              disabled={disabled}
              onClick={() => toggle(kind, r.id)}
              title={r.hint}
            >
              <Icon />
              <span className="max-w-[12rem] truncate">{r.label}</span>
            </Chip>
          ))}
        </div>
      </div>
    );

  return (
    <div className="space-y-3">
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Filter teams, lists, documents…"
        className="h-8"
        disabled={disabled}
      />
      <div className={cn("max-h-56 space-y-3 overflow-y-auto pr-1")}>
        {group(
          "Teams — everything inside",
          "space",
          targets.spaces.filter((s) => match(s.name)).map((s) => ({ id: s.id, label: s.name })),
          Hash,
        )}
        {group(
          "Lists — their tasks",
          "list",
          targets.lists
            .filter((l) => match(l.name) || match(spaceName.get(l.space_id ?? "") ?? ""))
            .map((l) => ({
              id: l.id,
              label: l.space_id ? `${spaceName.get(l.space_id) ?? "Team"} › ${l.name}` : l.name,
            })),
          ListIcon,
        )}
        {group(
          "Documents",
          "document",
          targets.documents.filter((d) => match(d.title)).slice(0, 60).map((d) => ({ id: d.id, label: d.title })),
          FileText,
        )}
      </div>
      <div className="flex items-center justify-between gap-3 rounded-md bg-muted px-3 py-2">
        <Label htmlFor="guest-can-edit" className="text-sm">
          Can edit
          <span className="block text-xs font-normal text-muted-foreground">
            Off = view and comment only
          </span>
        </Label>
        <Switch
          id="guest-can-edit"
          checked={canEdit}
          disabled={disabled || value.length === 0}
          onCheckedChange={(c) => onChange(value.map((v) => ({ ...v, can_edit: c })))}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        {value.length === 0
          ? "Pick at least one thing to share."
          : `${value.length} shared${canEdit ? " · can edit" : " · view only"}`}
      </p>
    </div>
  );
}
