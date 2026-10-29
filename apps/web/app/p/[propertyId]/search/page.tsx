import { RouteGate } from "@/components/gr8r/route-gate";
import { SearchView } from "@/components/gr8r/search-view";

export default async function SearchPage({
  params,
}: {
  params: Promise<{ propertyId: string }>;
}) {
  const { propertyId } = await params;
  return (
    <RouteGate segment="search">
      <SearchView propertyId={propertyId} />
    </RouteGate>
  );
}
