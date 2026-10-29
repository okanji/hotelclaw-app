import { Sk, SkTopbar } from "@/components/gr8r/route-skeleton";

/**
 * Suspense fallback for an individual task, shaped like gr8r's task drawer
 * markup that TaskDetail renders as a page: title + meta, the `.kv`
 * property list, then the description and activity blocks. The page's RSC
 * does no blocking fetch — the task list streams in — so this renders for
 * ~0 frames on a warm navigation from the board.
 */
export default function TaskDetailLoading() {
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col" aria-busy="true" aria-label="Loading">
      <SkTopbar crumbs={[56, 72]} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="page" style={{ maxWidth: 820 }}>
          <div className="col" style={{ gap: 10 }}>
            <Sk w={64} h={10} />
            <Sk w="60%" h={24} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "112px minmax(0, 1fr)", rowGap: 12, marginTop: 20 }}>
            {[110, 140, 90, 120, 100].map((w, i) => (
              <div key={i} style={{ display: "contents" }}>
                <Sk w={70} h={10} />
                <Sk w={w} h={10} />
              </div>
            ))}
          </div>
          <div className="col" style={{ gap: 8, marginTop: 28 }}>
            <Sk w="100%" h={11} />
            <Sk w="92%" h={11} />
            <Sk w="64%" h={11} />
          </div>
          <Sk w="100%" h={96} r={10} style={{ marginTop: 28 }} />
        </div>
      </div>
    </div>
  );
}
