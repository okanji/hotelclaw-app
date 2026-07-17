import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import type { FormStatus } from "@/lib/db/types";

/** Shared draft/published/closed badge for the forms list and detail header. */
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
  return <Badge variant="secondary">Draft</Badge>;
}
