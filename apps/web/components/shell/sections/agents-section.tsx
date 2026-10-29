"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bot,
  Brain,
  Inbox,
  LayoutGrid,
  Library,
  MessagesSquare,
  Plus,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  pendingApprovalsCountQueryOptions,
  podQueryOptions,
} from "@/lib/query/fleet-queries";
import { Gi } from "@/components/gr8r/icon";

/**
 * Secondary sidebar for the Agents section. ?view= switches list filters
 * without a route change (chatbots pattern); "Built-in AI" scrolls the same
 * list page to the transparency half.
 *
 * The Fleet group (pod bots / sessions / approvals / brain) renders only
 * for properties that belong to a client (pod). It owns the Realtime
 * invalidation for the approvals count + sessions list — push via
 * postgres_changes on bot_chat_sessions, never polling.
 */
export function AgentsSection({ propertyId }: { propertyId: string }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const qc = useQueryClient();
  const base = `/p/${propertyId}/agents`;
  const fleetBase = `${base}/fleet`;
  const onList = pathname === base;
  const view = params.get("view") ?? "all";

  const { data: pod } = useQuery(podQueryOptions(propertyId));
  const { data: approvalsCount = 0 } = useQuery({
    ...pendingApprovalsCountQueryOptions(propertyId),
    enabled: Boolean(pod),
  });

  useEffect(() => {
    if (!pod) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`fleet:${propertyId}:${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "bot_chat_sessions",
          filter: `property_id=eq.${propertyId}`,
        },
        () => {
          void qc.invalidateQueries({
            queryKey: ["fleet-approvals-count", propertyId],
          });
          void qc.invalidateQueries({ queryKey: ["fleet-sessions", propertyId] });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [pod, propertyId, qc]);

  const row = (
    href: string,
    label: string,
    icon: LucideIcon,
    on: boolean,
    tip: string,
    ct?: number,
  ) => (
    <Link
      key={href}
      href={href}
      className={on ? "sitem on" : "sitem"}
      title={tip}
      aria-current={on ? "page" : undefined}
    >
      <Gi icon={icon} />
      <span className="trunc">{label}</span>
      {ct ? <span className="ct dotc">{ct > 99 ? "99+" : ct}</span> : null}
    </Link>
  );

  return (
    <>
      {row(base, "All agents", LayoutGrid, onList && view === "all", "All agents")}
      {row(`${base}?new=1`, "New agent", Plus, false, "Create an agent")}
      {row(
        `${base}?view=builtin`,
        "Built-in AI",
        ShieldCheck,
        onList && view === "builtin",
        "Every built-in AI in the app",
      )}
      {row(
        `${base}/memory`,
        "Memory",
        Library,
        pathname === `${base}/memory`,
        "Browse what this property has learned",
      )}
      {pod ? (
        <div className="sgroup" style={{ marginTop: 8 }}>
          <div className="sgroup-h">
            <span className="trunc">Fleet · {pod.name}</span>
          </div>
          {row(
            fleetBase,
            "Pod bots",
            Bot,
            pathname === fleetBase || /\/fleet\/[0-9a-f-]{36}$/.test(pathname),
            "The pod bots serving this property",
          )}
          {row(
            `${fleetBase}/sessions`,
            "Sessions",
            MessagesSquare,
            pathname === `${fleetBase}/sessions`,
            "Chat sessions and workflow runs",
          )}
          {row(
            `${fleetBase}/approvals`,
            "Approvals",
            Inbox,
            pathname === `${fleetBase}/approvals`,
            "Gated actions waiting on a human",
            approvalsCount,
          )}
          {row(
            `${fleetBase}/access`,
            "API access",
            Brain,
            pathname === `${fleetBase}/access`,
            "Actions API keys for external automations",
          )}
        </div>
      ) : null}
    </>
  );
}
