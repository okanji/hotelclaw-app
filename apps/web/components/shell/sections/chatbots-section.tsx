"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { LayoutGrid, Globe, FilePen, MessagesSquare, Plus } from "lucide-react";
import { Gi } from "@/components/gr8r/icon";

/**
 * Secondary sidebar for the Chatbots section, in gr8r's `.sitem` rows (it
 * renders inside the tree node's `.sub`). Saved views use ?view= so the list
 * page can switch filters without a route change (workflows pattern).
 */
export function ChatbotsSection({ propertyId }: { propertyId: string }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const base = `/p/${propertyId}/chatbots`;
  const onList = pathname === base;
  const view = params.get("view") ?? "all";

  // A chatbot editor route (/chatbots/<botId>/...) has no sidebar item of its
  // own — keep its parent lit rather than leaving the sidebar unselected.
  const sub = pathname.startsWith(`${base}/`)
    ? pathname.slice(base.length + 1).split("/")[0]
    : null;
  const onEditor = sub !== null && sub !== "conversations";

  const pinned = [
    { id: "all", label: "All chatbots", icon: LayoutGrid },
    { id: "published", label: "Live", icon: Globe },
    { id: "drafts", label: "Drafts", icon: FilePen },
  ] as const;

  const row = (
    key: string,
    href: string,
    label: string,
    icon: typeof LayoutGrid,
    on: boolean,
    tip?: string,
  ) => (
    <Link
      key={key}
      href={href}
      className={on ? "sitem on" : "sitem"}
      title={tip}
      aria-current={on ? "page" : undefined}
    >
      <Gi icon={icon} size={14} />
      <span className="trunc">{label}</span>
    </Link>
  );

  return (
    <>
      {/* Root first, then create, then the saved cuts. */}
      {pinned.flatMap((v, i) => {
        const href = v.id === "all" ? base : `${base}?view=${v.id}`;
        const on = (onList && view === v.id) || (onEditor && v.id === "all");
        const out = [row(v.id, href, v.label, v.icon, on)];
        if (i === 0) {
          out.push(row("new", `${base}?new=1`, "New chatbot", Plus, false, "Create a chatbot"));
        }
        return out;
      })}
      {row(
        "conversations",
        `${base}/conversations`,
        "Conversations",
        MessagesSquare,
        pathname.startsWith(`${base}/conversations`),
        "Guest conversations",
      )}
    </>
  );
}
