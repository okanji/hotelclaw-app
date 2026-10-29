/**
 * Loading placeholder shaped like <InboxView> — the gr8r topbar, the `.ph`
 * title, then a `.panel` of `.nrow`-shaped shimmer rows. Shared by
 * `inbox/loading.tsx` and InboxView's pending state.
 */
export function InboxSkeleton() {
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col" aria-busy="true">
      <header className="topbar">
        <span className="sk" style={{ width: 16, height: 16 }} />
        <span className="sk" style={{ width: 80, height: 12 }} />
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="page" style={{ maxWidth: 820 }}>
          <div className="ph">
            <span className="sk" style={{ width: 160, height: 24 }} />
          </div>
          <div className="panel" style={{ overflow: "hidden" }}>
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="nrow" style={{ cursor: "default" }}>
                <span
                  className="sk"
                  style={{ width: 26, height: 26, borderRadius: "50%", flexShrink: 0 }}
                />
                <div className="grow" style={{ display: "grid", gap: 6, paddingTop: 2 }}>
                  <span className="sk" style={{ width: 140, height: 11 }} />
                  <span className="sk" style={{ width: "70%", height: 11 }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
