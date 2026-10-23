"use client";

import Link from "next/link";
import { Library } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SectionHeader } from "@/components/ui/section-header";
import { PageShell } from "@/components/ui/page-shell";
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
    <PageShell className="flex h-full flex-col overflow-y-auto px-8 pt-12 pb-16 sm:px-14 sm:pt-16">
      <SectionHeader
        size="page"
        eyebrow="Fleet"
        eyebrowTone="brand"
        title="API access"
        description="Who can reach this property from outside. Keys are shown once and stored hashed; secrets never appear here afterwards."
        actions={
          <Button
            variant="outline"
            size="sm"
            render={<Link href={`/p/${propertyId}/agents/memory`} />}
          >
            <Library data-icon="inline-start" />
            Browse memory
          </Button>
        }
      />
      <div className="h-10" />
      <section className="flex flex-col gap-4">
        <Eyebrow>Actions API</Eyebrow>
        {isOwner ? (
          <ActionsApiKeys propertyId={propertyId} />
        ) : (
          <p className="text-sm text-muted-foreground">Only owners manage API keys.</p>
        )}
      </section>
    </PageShell>
  );
}
