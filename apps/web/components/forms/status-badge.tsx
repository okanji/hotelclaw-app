import { StatusBadge } from "@/components/ui/status-badge";
import type { FormStatus } from "@/lib/db/types";

/**
 * Shared draft/published/closed badge for the forms list and detail header.
 * All three rungs are the house StatusBadge so a form's lifecycle reads with
 * the same pill geometry as a chatbot's or a workflow's — draft used to be a
 * bare `Badge variant="secondary"`, which is the same fill but a different
 * component and no state dot.
 */
export function FormStatusBadge({ status }: { status: FormStatus }) {
  if (status === "published") {
    return <StatusBadge tone="success">Published</StatusBadge>;
  }
  if (status === "closed") {
    return (
      <StatusBadge tone="neutral" dot={false}>
        Closed
      </StatusBadge>
    );
  }
  return (
    <StatusBadge tone="neutral" dot={false}>
      Draft
    </StatusBadge>
  );
}
