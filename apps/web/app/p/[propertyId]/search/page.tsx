import { SearchPageClient } from "@/components/chat/search/search-page-client";

export default async function SearchPage({
  params,
}: {
  params: Promise<{ propertyId: string }>;
}) {
  const { propertyId } = await params;
  return <SearchPageClient propertyId={propertyId} />;
}
