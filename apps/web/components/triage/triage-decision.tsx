"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Gi } from "@/components/gr8r/icon";
import { Kbd } from "@/components/ui/kbd";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { taskSuggestionsQueryOptions } from "@/components/tasks/task-triage-suggestions";
import { PRIORITY_MENU_ORDER, PRIORITY_META } from "@/components/tasks/kanban";
import { propertyMembersQueryOptions } from "@/lib/query/section-queries";
import {
  projectsQueryOptions,
  spacesQueryOptions,
} from "@/lib/query/project-queries";
import {
  acceptDefaults,
  type TriageFieldValues,
} from "@/lib/tasks/triage-logic";
import type { TriageQueueItem } from "@/lib/query/triage-queries";
import type { TaskPriority } from "@/lib/db/types";

/**
 * Accept / Decline for the selected triage item — Linear's two header
 * buttons. Accept opens a small form pre-filled from the task, with EMPTY
 * fields taken from the AI triage suggestion (`acceptDefaults`), so
 * "accept as suggested" is `1` then Enter. Decline asks for an optional
 * reason. Both popovers are controlled so the view's `1` / `2` shortcuts
 * can open them.
 */
export function TriageDecision({
  propertyId,
  task,
  busy,
  acceptOpen,
  onAcceptOpenChange,
  declineOpen,
  onDeclineOpenChange,
  onAccept,
  onDecline,
}: {
  propertyId: string;
  task: TriageQueueItem;
  busy: boolean;
  acceptOpen: boolean;
  onAcceptOpenChange: (open: boolean) => void;
  declineOpen: boolean;
  onDeclineOpenChange: (open: boolean) => void;
  onAccept: (values: TriageFieldValues) => void;
  onDecline: (note: string) => void;
}) {
  return (
    <div className="row" style={{ gap: 6 }}>
      <Popover open={declineOpen} onOpenChange={onDeclineOpenChange}>
        <PopoverTrigger
          render={
            <button type="button" className="btn btn-secondary btn-sm" disabled={busy} />
          }
        >
          <Gi icon={X} size={13} />
          Decline
          <span className="kbd">2</span>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80">
          <DeclineForm
            busy={busy}
            onSubmit={(note) => onDecline(note)}
            onCancel={() => onDeclineOpenChange(false)}
          />
        </PopoverContent>
      </Popover>

      <Popover open={acceptOpen} onOpenChange={onAcceptOpenChange}>
        <PopoverTrigger
          render={
            <button type="button" className="btn btn-primary btn-sm" disabled={busy} />
          }
        >
          <Gi icon={Check} size={13} />
          Accept
          <span
            className="kbd"
            style={{
              background: "color-mix(in srgb, var(--g8-on-accent) 18%, transparent)",
              color: "var(--g8-on-accent)",
              borderColor: "transparent",
            }}
          >
            1
          </span>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80">
          <AcceptForm
            key={task.id}
            propertyId={propertyId}
            task={task}
            busy={busy}
            onSubmit={onAccept}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

function AcceptForm({
  propertyId,
  task,
  busy,
  onSubmit,
}: {
  propertyId: string;
  task: TriageQueueItem;
  busy: boolean;
  onSubmit: (values: TriageFieldValues) => void;
}) {
  const { data: suggestions = [] } = useQuery(
    taskSuggestionsQueryOptions(propertyId, task.id),
  );
  const { data: spaces = [] } = useQuery(spacesQueryOptions(propertyId));
  const { data: members = [] } = useQuery(propertyMembersQueryOptions(propertyId));
  const { data: projects = [] } = useQuery(projectsQueryOptions(propertyId));

  // Mounted fresh each time the popover opens (the popup unmounts when
  // closed), so the defaults always reflect the latest task + suggestions.
  const [values, setValues] = useState<TriageFieldValues>(() =>
    acceptDefaults(task, suggestions),
  );
  const suggested = (field: "space" | "assignee" | "priority") =>
    suggestions.find((s) => s.field === field && s.status === "pending")
      ?.suggested_value;
  const mark = (field: "space" | "assignee" | "priority", value: string) =>
    suggested(field) === value ? " · suggested" : "";

  return (
    <form
      className="flex flex-col gap-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(values);
      }}
    >
      <PopoverHeader>
        <PopoverTitle>Accept to the board</PopoverTitle>
        <PopoverDescription>
          Route it now, or accept as is and sort it out later.
        </PopoverDescription>
      </PopoverHeader>

      <Field label="Team">
        <NativeSelect
          value={values.spaceId ?? ""}
          onChange={(e) => setValues((v) => ({ ...v, spaceId: e.target.value || null }))}
        >
          <option value="">No team</option>
          {spaces.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
              {mark("space", s.id)}
            </option>
          ))}
        </NativeSelect>
      </Field>

      <Field label="Assignee">
        <NativeSelect
          value={values.assigneeId ?? ""}
          onChange={(e) =>
            setValues((v) => ({ ...v, assigneeId: e.target.value || null }))
          }
        >
          <option value="">Unassigned</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name ?? m.email ?? "Member"}
              {mark("assignee", m.id)}
            </option>
          ))}
        </NativeSelect>
      </Field>

      <Field label="Priority">
        <NativeSelect
          value={values.priority}
          onChange={(e) =>
            setValues((v) => ({ ...v, priority: e.target.value as TaskPriority }))
          }
        >
          {PRIORITY_MENU_ORDER.map((p) => (
            <option key={p} value={p}>
              {PRIORITY_META[p].label}
              {mark("priority", p)}
            </option>
          ))}
        </NativeSelect>
      </Field>

      <Field label="Project">
        <NativeSelect
          value={values.projectId ?? ""}
          onChange={(e) =>
            setValues((v) => ({ ...v, projectId: e.target.value || null }))
          }
        >
          <option value="">No project</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </NativeSelect>
      </Field>

      <Button type="submit" disabled={busy} autoFocus className="mt-1">
        <Check />
        Accept
        <Kbd className="ml-auto bg-primary-foreground/15 text-primary-foreground">↵</Kbd>
      </Button>
    </form>
  );
}

function DeclineForm({
  busy,
  onSubmit,
  onCancel,
}: {
  busy: boolean;
  onSubmit: (note: string) => void;
  onCancel: () => void;
}) {
  const [note, setNote] = useState("");
  return (
    <form
      className="flex flex-col gap-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(note.trim());
      }}
    >
      <PopoverHeader>
        <PopoverTitle>Decline this issue</PopoverTitle>
        <PopoverDescription>
          It leaves the queue and never reaches the board. The reason is kept
          on its history.
        </PopoverDescription>
      </PopoverHeader>
      <Textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            onSubmit(note.trim());
          }
        }}
        placeholder="Reason (optional) — duplicate, not actionable…"
        maxLength={1000}
        rows={3}
        autoFocus
      />
      <div className="flex justify-end gap-1.5">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="destructive" size="sm" disabled={busy}>
          Decline
        </Button>
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid grid-cols-[72px_1fr] items-center gap-2">
      <span className="text-sm text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
