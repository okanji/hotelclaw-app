import { ImageResponse } from "next/og";

/**
 * Apple touch icon (iOS home screen / Safari). Safari ignores SVG `rel=icon`,
 * so this PNG covers it. The "claw rake" mark — three white rounded bars,
 * left-aligned and decreasing, raked -10° — on the brand gradient. Built from
 * divs (not the SVG file) because that's all `ImageResponse`/satori needs, so
 * no SVG rasterizer dependency is required.
 */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  const bar = { height: 20, borderRadius: 10, background: "#ffffff" } as const;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundImage: "linear-gradient(140deg, #4a154b, #c0317e)",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
            gap: 16,
            transform: "rotate(-10deg)",
          }}
        >
          <div style={{ ...bar, width: 110 }} />
          <div style={{ ...bar, width: 86 }} />
          <div style={{ ...bar, width: 62 }} />
        </div>
      </div>
    ),
    { ...size },
  );
}
