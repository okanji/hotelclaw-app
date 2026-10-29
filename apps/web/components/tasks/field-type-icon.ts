import {
  AlignLeft,
  AtSign,
  Banknote,
  CalendarDays,
  Hash,
  Link2,
  ListFilter,
  Paperclip,
  Phone,
  Network,
  SquareCheck,
  Tags,
  Type,
  Users,
  CircleGauge,
} from "lucide-react";
import type { CustomFieldType } from "@/lib/db/types";

/** One icon per custom-field type — the manager, filters, sidebar and list headers share it. */
export const FIELD_TYPE_ICON: Record<CustomFieldType, typeof Type> = {
  text: Type,
  long_text: AlignLeft,
  number: Hash,
  currency: Banknote,
  select: ListFilter,
  multi_select: Tags,
  date: CalendarDays,
  checkbox: SquareCheck,
  url: Link2,
  email: AtSign,
  phone: Phone,
  people: Users,
  files: Paperclip,
  relation: Network,
  progress: CircleGauge,
};
