import { Sk, SkHead, SkMini, SkPage } from "@/components/gr8r/route-skeleton";

/**
 * Suspense fallback for an assistant project home, mirroring `ProjectDetail`:
 * breadcrumb topbar, the `.ph` with the emoji `.picon`, then the composer +
 * conversations column beside the instructions / memory / context panels.
 * Same reason as the gallery's fallback — the navigation must commit on
 * click, not after the server render.
 */
export default function AssistantProjectLoading() {
  return (
    <SkPage variant="wide" style={{ maxWidth: 1200 }} crumbs={[72, 64, 120]}>
      <SkHead title={240} lede={360} icon />
      <div className="@container">
        <div className="grid gap-6 @3xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="stack" style={{ minWidth: 0 }}>
            <Sk w="100%" h={112} r={12} />
            <section className="panel">
              <div className="panel-h">
                <Sk w={110} h={12} />
              </div>
              <SkMini n={3} />
            </section>
          </div>
          <div className="stack">
            {[0, 1, 2].map((i) => (
              <section key={i} className="panel">
                <div className="panel-h">
                  <Sk w={90} h={12} />
                </div>
                <div className="panel-b stack" style={{ gap: 6 }}>
                  <Sk w="90%" />
                  <Sk w="70%" />
                </div>
              </section>
            ))}
          </div>
        </div>
      </div>
    </SkPage>
  );
}
