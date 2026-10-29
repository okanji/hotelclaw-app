import { Sk, SkHead, SkMini, SkPage, SkTabs } from "@/components/gr8r/route-skeleton";

/** Shaped like a cycle's page: `.ph`, the burn-up panel, then the by-status
 *  task panels beside the breakdown rail. */
export default function CycleDetailLoading() {
  return (
    <SkPage variant="wide" style={{ paddingTop: 20 }} crumbs={[72, 96]}>
      <SkHead title={200} lede={260} acts={2} />
      <div className="grid2">
        <div className="stack">
          <section className="panel">
            <div className="panel-h">
              <Sk w={90} h={12} />
            </div>
            <div className="panel-b">
              <Sk w="100%" h={200} r={8} />
            </div>
          </section>
          <section className="panel">
            <div className="panel-h">
              <Sk w={110} h={12} />
            </div>
            <SkMini n={6} />
          </section>
        </div>
        <section className="panel" style={{ alignSelf: "start" }}>
          <div className="panel-b" style={{ paddingTop: 8 }}>
            <SkTabs n={3} />
            <SkMini n={5} />
          </div>
        </section>
      </div>
    </SkPage>
  );
}
