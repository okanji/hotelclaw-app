"use client";

import Link from "next/link";
import { Library, Lock, Sparkles } from "lucide-react";
import { Gi } from "@/components/gr8r/icon";
import { PageHeader } from "@/components/shell/page-header";
import { ActionsApiKeys } from "./actions-api-dialog";

/**
 * API access — the property's Actions API key manager for external
 * automations. (This page was "Brain & access" until the gbrain server
 * retired; pod knowledge now lives in property memory like every other
 * property's, browsable under Agents → Memory.)
 */
export function AccessView({ propertyId, isOwner }: { propertyId: string; isOwner: boolean }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        breadcrumbs={[
          { label: "Agents", href: `/p/${propertyId}/agents`, icon: <Sparkles /> },
          { label: "API access" },
        ]}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="page">
          <div className="ph">
            <div>
              <h1>API access</h1>
              <p>Actions API keys for external automations. Keys are shown once and stored hashed.</p>
            </div>
            <div className="acts">
              <Link href={`/p/${propertyId}/agents/memory`} className="btn btn-secondary btn-sm">
                <Gi icon={Library} size={14} />
                Browse memory
              </Link>
            </div>
          </div>
          {isOwner ? (
            <ActionsApiKeys propertyId={propertyId} />
          ) : (
            <div className="alert info">
              <Gi icon={Lock} size={15} />
              <div>Only owners manage API keys.</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
