import { SkCards, SkHead, SkPage } from "@/components/gr8r/route-skeleton";

/**
 * Suspense fallback for the assistant projects gallery, shaped like the gr8r
 * page (`.ph` + `.pgrid` of project cards). Without it, this segment is the
 * only kind of sidebar click in the app that commits nothing until the whole
 * server render lands — seconds of a dead screen that reads as a broken
 * link, not a slow one.
 */
export default function AssistantProjectsLoading() {
  return (
    <SkPage crumbs={[72, 64]}>
      <SkHead title={130} lede={300} acts={1} />
      <SkCards n={4} />
    </SkPage>
  );
}
