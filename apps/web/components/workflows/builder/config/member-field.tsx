"use client";

import { Database } from "lucide-react";
import type { PropertyMember } from "@/lib/query/section-queries";
import type { RefCandidate } from "@/lib/workflows/refs";
import { WorkflowSelect } from "@/components/workflows/builder/workflow-select";
import {
  InsertDataPopover,
  TemplateField,
} from "@/components/workflows/builder/config/template-field";
import { PopoverTrigger } from "@/components/ui/popover";

function pureRefPath(value: string): string | null {
  const m = (value ?? "").match(/^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/);
  return m ? m[1]!.trim() : null;
}

function memberLabel(m: PropertyMember): string {
  return m.name?.trim() || m.email?.trim() || m.id;
}

// Picks a property member by NAME while storing the user id — a raw uuid in
// this field is unreadable. Three states:
//   • value is a {{ref}}            → TemplateField renders its friendly chip
//   • value is a known member id    → name select (id never shown)
//   • unknown id / members missing  → TemplateField so nothing is ever stuck
export function MemberField({
  value,
  onChange,
  placeholder,
  required,
  members,
  membersLoading,
  refs,
  invalid,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  required?: boolean;
  members: PropertyMember[];
  membersLoading?: boolean;
  refs: RefCandidate[];
  invalid?: boolean;
}) {
  const bound = pureRefPath(value);
  const knownId = members.some((m) => m.id === value);

  if (bound || (value.trim() !== "" && !knownId && !membersLoading) || (members.length === 0 && !membersLoading)) {
    return (
      <TemplateField
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        mono
        refs={refs}
        invalid={invalid}
      />
    );
  }

  return (
    <div className="space-y-1.5">
      <WorkflowSelect
        ariaLabel="Person"
        value={knownId ? value : ""}
        onChange={(e) => onChange(e.target.value)}
        disabled={membersLoading}
        className={invalid ? "border-destructive" : undefined}
      >
        {membersLoading ? (
          <option value="">Loading people…</option>
        ) : (
          <option value="">
            {required ? placeholder ?? "Pick a person…" : "No one"}
          </option>
        )}
        {members.map((m) => (
          <option key={m.id} value={m.id}>
            {memberLabel(m)}
          </option>
        ))}
      </WorkflowSelect>
      <InsertDataPopover refs={refs} onInsert={(p) => onChange(`{{${p}}}`)}>
        <PopoverTrigger
          className="inline-flex items-center gap-1.5 rounded-md px-1 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          title="Use data from the trigger or an earlier step instead"
        >
          <Database className="size-3.5" aria-hidden /> Use data instead
        </PopoverTrigger>
      </InsertDataPopover>
    </div>
  );
}
