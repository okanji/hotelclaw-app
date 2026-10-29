import { Sk, SkHead, SkPage, SkRows } from "@/components/gr8r/route-skeleton";

/**
 * Suspense fallback for the Documents segment, shaped like the gr8r Files
 * home (`.page.wide` › `.ph` › toolbar › boards shelf › list). Without it,
 * navigating here keeps the previous page on screen for the whole server
 * roundtrip. An individual document has its own (null) fallback — the editor
 * skeleton lives in `<DocumentsSurface>`.
 */
export default function DocumentsLoading() {
  return (
    <SkPage variant="wide" crumbs={[64]}>
      <SkHead title={90} lede={300} />
      <div className="row" style={{ gap: 8, marginBottom: 20 }}>
        <Sk w={220} h={28} r={7} />
        <Sk w={90} h={28} r={7} />
        <span className="sp" />
        <Sk w={64} h={28} r={7} />
        <Sk w={96} h={28} r={7} />
      </div>
      <div className="row" style={{ gap: 12, marginBottom: 28 }}>
        {Array.from({ length: 4 }, (_, i) => (
          <Sk key={i} w={176} h={120} r={10} />
        ))}
      </div>
      <section className="panel">
        <SkRows n={8} pad={14} />
      </section>
    </SkPage>
  );
}
