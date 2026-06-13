import { Badge } from "@/components/ui/badge";
import type { FormStatus } from "@/lib/db/types";

/** Shared draft/published/closed badge for the forms list and detail header. */
export function FormStatusBadge({ status }: { status: FormStatus }) {
  if (status === "published") {
    return (
      <Badge
        variant="outline"
        className="border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
      >
        Published
      </Badge>
    );
  }
  if (status === "closed") {
    return (
      <Badge variant="outline" className="text-muted-foreground">
        Closed
      </Badge>
    );
  }
  return <Badge variant="secondary">Draft</Badge>;
}
