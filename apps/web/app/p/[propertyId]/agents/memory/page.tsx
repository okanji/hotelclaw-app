import { notFound } from "next/navigation";
import { getMembershipForProperty } from "@/lib/auth/session";
import { memoryStore } from "@/lib/memory/store";
import { MemoryBrowser } from "@/components/memory/memory-browser";

/**
 * Memory — what the property's AI remembers, browsable. Available to EVERY
 * property: memory is rows in the app's own Postgres (no provisioning,
 * no external brain). The first listing is fetched here so the first
 * paint isn't a spinner.
 */
export default async function MemoryPage({
  params,
}: {
  params: Promise<{ propertyId: string }>;
}) {
  const { propertyId } = await params;
  const membership = await getMembershipForProperty(propertyId);
  if (!membership) notFound();

  const store = memoryStore();
  const [memories, counts] = await Promise.all([
    store.listProperty(propertyId, { limit: 100 }),
    store.counts(propertyId),
  ]);

  return (
    <MemoryBrowser
      propertyId={propertyId}
      initial={{ memories, counts }}
      canCurate={membership.role === "owner" || membership.role === "manager"}
    />
  );
}
