"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardList, LayoutList, Plus, Sparkles } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { formsListQueryOptions } from "@/lib/query/section-queries";
import { Gi } from "@/components/gr8r/icon";

/**
 * Secondary sidebar for the Forms section (ClickUp-style forms hub): create
 * entry points up top — New form and the AI draft flow, both handled by the
 * forms index page via `?new=1` / `?ai=1` — then one row per form. Draft
 * forms sit in faint ink. Realtime on
 * `forms` (migration 0100) keeps the list live across sessions.
 */
export function FormsSection({ propertyId }: { propertyId: string }) {
  const pathname = usePathname();
  const qc = useQueryClient();
  const base = `/p/${propertyId}/forms`;

  const { data: forms = [] } = useQuery(formsListQueryOptions(propertyId));

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`forms-list:${propertyId}:${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "forms",
          filter: `property_id=eq.${propertyId}`,
        },
        () => {
          void qc.invalidateQueries({ queryKey: ["forms", propertyId] });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [propertyId, qc]);

  // gr8r sidebar markup (`.sitem` rows, `.sgroup-h` label) — rendered inside
  // the Forms row's `.sub` in the shell tree.
  return (
    <>
      <Link
        href={base}
        className={pathname === base ? "sitem on" : "sitem"}
        title="All forms & responses"
        aria-current={pathname === base ? "page" : undefined}
      >
        <Gi icon={LayoutList} size={14} />
        <span className="trunc">All forms</span>
      </Link>
      <Link href={`${base}?new=1`} className="sitem" title="New form">
        <Gi icon={Plus} size={14} />
        <span className="trunc">New form</span>
      </Link>
      <Link
        href={`${base}?ai=1`}
        className="sitem"
        title="Describe the form you need and AI drafts it"
      >
        <Gi icon={Sparkles} size={14} />
        <span className="trunc">Draft with AI</span>
      </Link>

      {forms.length > 0 ? (
        <>
          <div className="sgroup-h">Forms</div>
          {forms.map((f) => {
            const href = `${base}/${f.id}`;
            const on = pathname.startsWith(href);
            return (
              <Link
                key={f.id}
                href={href}
                className={on ? "sitem on" : "sitem"}
                title={f.title || "Untitled form"}
                aria-current={on ? "page" : undefined}
                // Draft forms sit in faint ink.
                style={f.status === "draft" && !on ? { color: "var(--g8-text-3)" } : undefined}
              >
                {f.icon ? (
                  <span aria-hidden="true" style={{ width: 14, textAlign: "center", fontSize: 13 }}>
                    {f.icon}
                  </span>
                ) : (
                  <Gi icon={ClipboardList} size={14} />
                )}
                <span className="trunc">{f.title || "Untitled form"}</span>
              </Link>
            );
          })}
        </>
      ) : null}
    </>
  );
}
