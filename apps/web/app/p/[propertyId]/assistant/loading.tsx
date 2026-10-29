import { Sk, SkPage, SkPanel } from "@/components/gr8r/route-skeleton";

/**
 * Suspense fallback for the assistant workspace, shaped like its gr8r home
 * (centred `.ph` headline + hero composer, then the projects / recents
 * panels) so arriving from the projects pages commits instantly instead of
 * holding the old page while the server renders.
 *
 * Same-route `?c=` hops (sidebar recents, a project's conversation links) do
 * NOT re-trigger this boundary — verified live: the workspace stays mounted
 * and picks the tab up through `useSearchParams`, which is what keeps its
 * panes' event streams alive. Only cross-segment arrivals show it.
 */
export default function AssistantLoading() {
  return (
    <SkPage style={{ maxWidth: 760, paddingTop: 56 }} crumbs={null}>
      <div className="ph" style={{ justifyContent: "center" }}>
        <div className="col" style={{ gap: 10, alignItems: "center", width: "100%" }}>
          <Sk w={300} h={24} style={{ maxWidth: "100%" }} />
          <Sk w={420} h={11} style={{ maxWidth: "100%" }} />
        </div>
      </div>
      <Sk w="100%" h={128} r={12} />
      <div className="stack" style={{ marginTop: 32 }}>
        <SkPanel n={3} title={70} />
        <SkPanel n={4} title={60} />
      </div>
    </SkPage>
  );
}
