import { PStatus } from "@/components/gr8r/home-glyphs";
import type { FormStatus } from "@/lib/db/types";

/**
 * Shared draft/published/closed pill for the forms list, detail header and
 * settings — gr8r's `.pstatus` (a hairline pill with a coloured state dot),
 * the same geometry a project's status uses.
 */
const META: Record<FormStatus, { name: string; color: string }> = {
  published: { name: "Published", color: "var(--g8-green)" },
  closed: { name: "Closed", color: "var(--g8-gray)" },
  draft: { name: "Draft", color: "var(--g8-amber)" },
};

export function FormStatusBadge({ status }: { status: FormStatus }) {
  const m = META[status] ?? META.draft;
  return <PStatus name={m.name} color={m.color} />;
}
