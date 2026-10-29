import { SkHead, SkPage, SkPanel, Sk } from "@/components/gr8r/route-skeleton";

/** Shaped like the cycles timeline: `.ph`, the current cycle's panel, then
 *  the past / upcoming cycle panels. */
export default function CyclesLoading() {
  return (
    <SkPage style={{ maxWidth: 1000 }} crumbs={[72]}>
      <SkHead title={120} lede={280} acts={1} />
      <div className="stack">
        <section className="panel">
          <div className="panel-h">
            <Sk w={140} h={12} />
            <span className="sp" />
            <Sk w={80} h={10} />
          </div>
          <div className="panel-b stack" style={{ gap: 12 }}>
            <Sk w="100%" h={6} r={6} />
            <Sk w="100%" h={180} r={8} />
          </div>
        </section>
        <SkPanel n={3} title={90} />
        <SkPanel n={3} title={90} />
      </div>
    </SkPage>
  );
}
