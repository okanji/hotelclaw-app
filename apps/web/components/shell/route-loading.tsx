import { AuthShell } from "@/components/auth/auth-shell";

/**
 * Loading state for the narrow routes outside the property shell — gr8r's
 * `sk()` shimmer bars (src/shell/skeletons.js, `.sk` in states.css) laid
 * out where the auth card's plate, title, sub-line, two fields and the
 * button land, inside the same frame, so nothing jumps when the real card
 * swaps in.
 */
export function RouteLoading({ wide = false }: { wide?: boolean }) {
  const sk = (width: string | number, height: number, radius?: number | string) => (
    <span
      className="sk"
      style={{ width, height, ...(radius !== undefined ? { borderRadius: radius } : null) }}
    />
  );
  return (
    <AuthShell>
      <div
        className="auth-card"
        aria-busy="true"
        aria-label="Loading"
        style={wide ? { maxWidth: 560 } : undefined}
      >
        <div style={{ display: "flex", justifyContent: "center" }}>
          {sk(44, 44, 11)}
        </div>
        <div className="col" style={{ gap: 8, alignItems: "center" }}>
          {sk("60%", 22)}
          {sk("80%", 12)}
        </div>
        {[0, 1].map((i) => (
          <div key={i} className="col" style={{ gap: 6 }}>
            {sk(70, 10)}
            {sk("100%", 36, 6)}
          </div>
        ))}
        {sk("100%", 36, 6)}
      </div>
    </AuthShell>
  );
}
