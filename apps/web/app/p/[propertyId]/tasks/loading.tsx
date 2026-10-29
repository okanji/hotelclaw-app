import { Sk, SkBoard, SkTopbar } from "@/components/gr8r/route-skeleton";

/**
 * Suspense fallback for the Tasks route, shaped like the gr8r board
 * (`.page.flush` › `.ph` › `.toolbar` › `.board`) so the transition shows no
 * jump. The page's RSC does no blocking data fetch — the task list streams
 * in — so this renders for ~0 frames on a warm navigation.
 */
export default function TasksLoading() {
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col" aria-busy="true" aria-label="Loading">
      <SkTopbar crumbs={[56]} />
      <div className="page flush" style={{ flex: "1 1 0", minHeight: 0 }}>
        <div className="ph">
          <div className="col" style={{ gap: 8 }}>
            <Sk w={120} h={20} />
            <Sk w={220} h={11} />
          </div>
        </div>
        <div className="toolbar">
          <Sk w={180} h={26} r={7} />
          <Sk w={70} h={26} r={7} />
          <span className="sp" />
          <Sk w={120} h={26} r={7} />
        </div>
        <SkBoard />
      </div>
    </div>
  );
}
