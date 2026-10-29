import Link from "next/link";
import { FileQuestionMark } from "lucide-react";
import { Gi } from "@/components/gr8r/icon";
import { FullState, GoBackButton } from "@/components/shell/route-error";

/**
 * In-shell 404 for the property content pane — rendered when a page throws
 * `notFound()` (e.g. a task or document that was deleted or archived, often
 * reached via a stale link the sidebar remembered in localStorage). The
 * sidebar stays mounted; only this pane shows gr8r's `page404`.
 */
export default function PropertyNotFound() {
  return (
    <div className="h-full min-h-0 flex-1 overflow-y-auto">
      <FullState
        icon={<Gi icon={FileQuestionMark} size={20} />}
        code="ERROR 404"
        title="Not found"
        message="This item doesn't exist anymore — it may have been deleted or archived. Check the link or head back home."
      >
        <GoBackButton />
        <Link href="/" className="btn btn-primary">
          Go to Home
        </Link>
      </FullState>
    </div>
  );
}
