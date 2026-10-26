"use client";

import Link from "next/link";
import { Library, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/ui/page-shell";
import { PageHeader } from "@/components/shell/page-header";
import { Eyebrow } from "@/components/ui/eyebrow";
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
        actions={
          <Button nativeButton={false}
            variant="outline"
            size="sm"
            render={<Link href={`/p/${propertyId}/agents/memory`} />}
          >
            <Library data-icon="inline-start" />
            Browse memory
          </Button>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto pt-4 pb-16">
        <PageShell width="full" className="flex flex-col">
          <section className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <Eyebrow>Actions API</Eyebrow>
              <p className="text-sm text-muted-foreground">
                Keys are shown once and stored hashed.
              </p>
            </div>
            {isOwner ? (
              <ActionsApiKeys propertyId={propertyId} />
            ) : (
              <p className="text-sm text-muted-foreground">Only owners manage API keys.</p>
            )}
          </section>
        </PageShell>
      </div>
    </div>
  );
}
