import type { MetadataRoute } from "next";

/**
 * PWA web app manifest. Next auto-serves this at /manifest.webmanifest and
 * injects <link rel="manifest">. The SVG icon with sizes "any" satisfies
 * Android/Chrome installability; iOS uses the apple-icon route separately.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Hotelclaw",
    short_name: "Hotelclaw",
    description:
      "AI-first productivity and communications platform for hotels and restaurants.",
    start_url: "/",
    display: "standalone",
    background_color: "#0a0a0a",
    theme_color: "#4a154b",
    icons: [
      { src: "/icon.svg", type: "image/svg+xml", sizes: "any" },
    ],
  };
}
