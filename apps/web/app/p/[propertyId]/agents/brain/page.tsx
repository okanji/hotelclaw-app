import { notFound } from "next/navigation";
import { getMembershipForProperty } from "@/lib/auth/session";
import { resolvePropertyBrain } from "@/lib/brain/client";
import { listBrainPages } from "@/lib/brain/browse";
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
  const initialPages = binding ? await listBrainPages(binding) : null;

  return (
    <BrainBrowser
      propertyId={propertyId}
      configured={Boolean(binding)}
      source={binding?.source ?? null}
      initialPages={initialPages}
      canCurate={membership.role === "owner" || membership.role === "manager"}
      canArchive={membership.role === "owner"}
    />
  );
}
