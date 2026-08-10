import { notFound } from "next/navigation";
import { getMembershipForProperty } from "@/lib/auth/session";
import { resolvePropertyBrain } from "@/lib/brain/client";
import { listBrainPages } from "@/lib/brain/browse";
import { loadBrainOverview } from "@/lib/brain/overview";
import { BrainBrowser } from "@/components/brain/brain-browser";

/**
 * Brain — the property's knowledge, browsable. Available to EVERY property
 * (not just pods): the binding resolves per property server-side; without
 * one the browser renders its not-provisioned state. The initial page index
 * is fetched here so the first paint isn't a spinner.
 */
export default async function BrainPage({
  params,
}: {
  params: Promise<{ propertyId: string }>;
}) {
  const { propertyId } = await params;
  const membership = await getMembershipForProperty(propertyId);
  if (!membership) notFound();

  const binding = await resolvePropertyBrain(propertyId);
  const initialPages = binding
    ? await listBrainPages(binding, { propertyId })
    : null;
  const overview = await loadBrainOverview(propertyId, initialPages, {
    hasBinding: Boolean(binding),
  });

  return (
    <BrainBrowser
      propertyId={propertyId}
      configured={Boolean(binding)}
      source={binding?.source ?? null}
      initialPages={initialPages}
      overview={overview}
      isOwner={membership.role === "owner"}
      canCurate={membership.role === "owner" || membership.role === "manager"}
      canArchive={membership.role === "owner"}
    />
  );
}
