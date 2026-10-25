import {
  AlignLeft,
  CalendarDays,
  CircleDot,
  Hash,
  Heading,
  Layers,
  ListChecks,
  Mail,
  Paperclip,
  PenLine,
  Phone,
  Pilcrow,
  ShieldCheck,
  Star,
  Tags,
  ToggleLeft,
  Type,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import type { TintTone } from "@/components/ui/tint-card";
import { PRIORITY_FIELD_OPTIONS, type FormFieldType } from "@/lib/forms/schema";
import type { FieldPreset } from "./form-builder-extras";

/**
 * The builder's field vocabulary — one place for each type's palette label
 * and icon, and the studio-style "Add a field" groups (tinted tiles in the
 * side card, the same groups in every card's "add below" menu).
 */

export const FIELD_KIND: Record<FormFieldType, { label: string; icon: LucideIcon }> = {
  short_text: { label: "Short answer", icon: Type },
  long_text: { label: "Long answer", icon: AlignLeft },
  email: { label: "Email", icon: Mail },
  phone: { label: "Phone", icon: Phone },
  number: { label: "Number", icon: Hash },
  date: { label: "Date", icon: CalendarDays },
  select: { label: "Choose one", icon: CircleDot },
  multi_select: { label: "Tick all that apply", icon: ListChecks },
  yes_no: { label: "Yes / no", icon: ToggleLeft },
  rating: { label: "Rating", icon: Star },
  people: { label: "Person", icon: UserRound },
  file: { label: "Attachment", icon: Paperclip },
  consent: { label: "Consent statement", icon: ShieldCheck },
  signature: { label: "Signature", icon: PenLine },
  section: { label: "Section heading", icon: Heading },
  info: { label: "Paragraph of text", icon: Pilcrow },
};

export type PaletteKind = {
  key: string;
  label: string;
  icon: LucideIcon;
  preset: FieldPreset;
};

export type PaletteGroup = { label: string; tone: TintTone; kinds: PaletteKind[] };

const kind = (type: FormFieldType, preset: Partial<FieldPreset> = {}): PaletteKind => ({
  key: type,
  label: FIELD_KIND[type].label,
  icon: FIELD_KIND[type].icon,
  preset: { type, ...preset },
});

export const PALETTE: PaletteGroup[] = [
  {
    label: "Questions",
    tone: "blue",
    kinds: [
      kind("short_text"),
      kind("long_text"),
      kind("email"),
      kind("phone"),
      kind("number"),
      kind("date"),
      kind("select"),
      kind("multi_select"),
      kind("yes_no"),
      kind("rating"),
      kind("people"),
      kind("file"),
    ],
  },
  {
    label: "Agreements",
    tone: "sage",
    kinds: [
      kind("consent", {
        label: "Consent",
        description: "I have read and agree to the terms above.",
        required: true,
      }),
      kind("signature", { label: "Signature" }),
    ],
  },
  {
    // ClickUp's "Task property" questions: answers write a structured field
    // on the task each submission creates.
    label: "Task fields",
    tone: "honey",
    kinds: [
      {
        key: "tp-assignee",
        label: "Assignee",
        icon: UserRound,
        preset: { type: "people", label: "Assignee", taskProperty: "assignee" },
      },
      {
        key: "tp-priority",
        label: "Priority",
        icon: Layers,
        preset: {
          type: "select",
          label: "Priority",
          taskProperty: "priority",
          options: PRIORITY_FIELD_OPTIONS.map((o) => ({ ...o })),
        },
      },
      {
        key: "tp-due",
        label: "Due date",
        icon: CalendarDays,
        preset: { type: "date", label: "Due date", taskProperty: "due_date" },
      },
      {
        key: "tp-tags",
        label: "Tags",
        icon: Tags,
        preset: {
          type: "multi_select",
          label: "Tags",
          taskProperty: "labels",
          source: { kind: "labels" },
        },
      },
    ],
  },
  {
    label: "Text",
    tone: "lavender",
    kinds: [
      kind("section", { label: "Section heading" }),
      kind("info", { label: "Add your text here" }),
    ],
  },
];

export const PALETTE_KINDS: PaletteKind[] = PALETTE.flatMap((g) => g.kinds);

export function paletteKind(key: string): PaletteKind | undefined {
  return PALETTE_KINDS.find((k) => k.key === key);
}

export function paletteTone(key: string): TintTone {
  return PALETTE.find((g) => g.kinds.some((k) => k.key === key))?.tone ?? "blue";
}
