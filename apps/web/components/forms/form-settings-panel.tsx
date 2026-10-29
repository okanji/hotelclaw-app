"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Gi } from "@/components/gr8r/icon";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FORM_BACKGROUNDS, type FormSettings } from "@/lib/forms/schema";
import type { FormStatus } from "@/lib/db/types";
import { FORM_BACKGROUND_CLASSES, FORM_BACKGROUND_LABELS } from "./backgrounds";
import { FormStatusBadge } from "./status-badge";
import { TaskAutomationCard } from "./task-automation-card";
import { deleteForm } from "./actions";

/**
 * The builder side card's "Form settings" tab (studio's settings card): the
 * form's lifecycle, who can respond, what happens after submitting
 * (including the create-a-task automation), and how the fill page looks.
 * Everything writes through autosave — column settings immediately,
 * presentation settings with the schema.
 */
export function FormSettingsPanel({
  propertyId,
  formId,
  formTitle,
  status,
  statusBusy,
  onStatusChange,
  icon,
  onIconChange,
  allowMultiple,
  anonymous,
  onToggle,
  settings,
  onPatchSettings,
}: {
  propertyId: string;
  formId: string;
  formTitle: string;
  status: FormStatus;
  statusBusy: boolean;
  onStatusChange: (status: FormStatus) => void;
  icon: string;
  onIconChange: (icon: string) => void;
  allowMultiple: boolean;
  anonymous: boolean;
  onToggle: (key: "allow_multiple" | "anonymous", next: boolean) => void;
  settings: FormSettings;
  onPatchSettings: (patch: Partial<FormSettings>) => void;
}) {
  const router = useRouter();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, startDelete] = useTransition();

  function remove() {
    startDelete(async () => {
      const result = await deleteForm(formId);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Form deleted");
      router.push(`/p/${propertyId}/forms`);
    });
  }

  return (
    <>
      <Group title="Status" hint="Only published forms accept responses.">
        <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
          <FormStatusBadge status={status} />
          <span className="sp" />
          {status !== "published" ? (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => onStatusChange("published")}
              disabled={statusBusy}
            >
              Publish
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => onStatusChange("draft")}
              disabled={statusBusy}
            >
              Unpublish
            </button>
          )}
          {status !== "closed" ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => onStatusChange("closed")}
              disabled={statusBusy}
            >
              Close
            </button>
          ) : null}
        </div>
      </Group>

      <div className="panel g8-fs-toggles">
        <Toggle
          id="fs-allow-multiple"
          label="Multiple responses"
          help="Each member can submit more than once, e.g. a request form."
          checked={allowMultiple}
          onChange={(next) => onToggle("allow_multiple", next)}
        />
        <Toggle
          id="fs-anonymous"
          label="Anonymous"
          help="Never store who submitted — for honest staff feedback."
          checked={anonymous}
          onChange={(next) => onToggle("anonymous", next)}
        />
      </div>

      <TaskAutomationCard propertyId={propertyId} formId={formId} />

      <Group title="After submitting">
        <div className="grid gap-2">
          <Label htmlFor="fs-submit-label">Button label</Label>
          <Input
            id="fs-submit-label"
            value={settings.submitLabel ?? ""}
            maxLength={40}
            placeholder="Submit"
            onChange={(e) => onPatchSettings({ submitLabel: e.target.value || undefined })}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="fs-confirmation">Thank-you message</Label>
          <Textarea
            id="fs-confirmation"
            value={settings.confirmationMessage ?? ""}
            placeholder="Thanks — your answers have been submitted."
            rows={2}
            maxLength={500}
            onChange={(e) =>
              onPatchSettings({ confirmationMessage: e.target.value || undefined })
            }
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="fs-redirect">Then send them to</Label>
          <Input
            id="fs-redirect"
            value={settings.redirectUrl ?? ""}
            placeholder="https:// (optional)"
            onChange={(e) => onPatchSettings({ redirectUrl: e.target.value || undefined })}
          />
        </div>
      </Group>

      <Group title="Look">
        <div className="grid gap-2">
          <Label htmlFor="fs-icon">Icon</Label>
          <Input
            id="fs-icon"
            value={icon}
            onChange={(e) => onIconChange(e.target.value)}
            placeholder="An emoji, e.g. 🛠️"
            className="w-32"
            maxLength={16}
          />
        </div>
        <div className="grid gap-2">
          <span className="label">Layout on one page</span>
          <div className="flex gap-1.5">
            {(
              [
                { value: "one", label: "One column" },
                { value: "two", label: "Two columns" },
              ] as const
            ).map((opt) => (
              <Chip
                key={opt.value}
                size="sm"
                selected={(settings.layout ?? "one") === opt.value}
                onClick={() =>
                  onPatchSettings({ layout: opt.value === "one" ? undefined : opt.value })
                }
              >
                {opt.label}
              </Chip>
            ))}
          </div>
        </div>
        <div className="grid gap-2">
          <span className="label">Background</span>
          <div className="flex flex-wrap gap-2">
            {FORM_BACKGROUNDS.map((bg) => {
              const active = (settings.background ?? "default") === bg;
              return (
                <button
                  key={bg}
                  type="button"
                  aria-pressed={active}
                  aria-label={`Background ${FORM_BACKGROUND_LABELS[bg]}`}
                  title={FORM_BACKGROUND_LABELS[bg]}
                  onClick={() => onPatchSettings({ background: bg === "default" ? undefined : bg })}
                  className={cn(
                    "size-8 rounded-md shadow-ring transition-transform focus-visible:shadow-focus focus-visible:outline-none",
                    FORM_BACKGROUND_CLASSES[bg],
                    active && "scale-110 shadow-focus",
                  )}
                />
              );
            })}
          </div>
        </div>
      </Group>

      <Group title="Delete" hint="Deleting a form removes all of its responses.">
        <button
          type="button"
          className="btn btn-danger-ghost btn-sm"
          style={{ width: "fit-content" }}
          onClick={() => setConfirmDelete(true)}
        >
          <Gi icon={Trash2} size={13} />
          Delete form
        </button>
      </Group>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete form?</DialogTitle>
            <DialogDescription>
              &ldquo;{formTitle}&rdquo; and all of its responses will be permanently deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setConfirmDelete(false)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button type="button" variant="destructive" onClick={remove} disabled={deleting}>
              {deleting ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Group({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="grid gap-3">
      <div>
        <h3 className="g8-fs-h">{title}</h3>
        {hint ? (
          <p className="hint" style={{ margin: "2px 0 0" }}>
            {hint}
          </p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function Toggle({
  id,
  label,
  help,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  help: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="row" style={{ alignItems: "flex-start", gap: 16, padding: "10px 12px" }}>
      <label htmlFor={id} className="grow" style={{ display: "grid", gap: 2 }}>
        <span style={{ fontWeight: 500 }}>{label}</span>
        <span className="hint">{help}</span>
      </label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} className="mt-0.5" />
    </div>
  );
}
