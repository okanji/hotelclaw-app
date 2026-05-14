import type { Attachment } from "stream-chat";

/** Slack-style ordinal suffix: 1st, 2nd, 3rd, 4th, … */
function ordinalSuffix(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return "th";
  switch (n % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
}

/** "Apr 26th" for current year, "Dec 25th, 2025" otherwise. */
export function formatSharedDate(input: string | Date | undefined): string {
  if (!input) return "";
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return "";
  const month = d.toLocaleString(undefined, { month: "short" });
  const day = d.getDate();
  const dayStr = `${day}${ordinalSuffix(day)}`;
  const now = new Date();
  if (d.getFullYear() === now.getFullYear()) {
    return `${month} ${dayStr}`;
  }
  return `${month} ${dayStr}, ${d.getFullYear()}`;
}

/** Best-available thumbnail/asset URL for an image or video attachment. */
export function mediaThumbUrl(a: Attachment): string | undefined {
  if (typeof a.thumb_url === "string" && a.thumb_url) return a.thumb_url;
  if (typeof a.image_url === "string" && a.image_url) return a.image_url;
  if (typeof a.asset_url === "string" && a.asset_url) return a.asset_url;
  return undefined;
}

/** Best-available download URL for a document/file attachment. */
export function docAssetUrl(a: Attachment): string | undefined {
  if (typeof a.asset_url === "string" && a.asset_url) return a.asset_url;
  if (typeof a.image_url === "string" && a.image_url) return a.image_url;
  return undefined;
}

/** A user-facing label even when the attachment lacks a title/filename. */
export function fileLabel(a: Attachment, fallback = "Untitled"): string {
  if (typeof a.title === "string" && a.title) return a.title;
  if (typeof a.fallback === "string" && a.fallback) return a.fallback;
  const url = docAssetUrl(a) ?? mediaThumbUrl(a);
  if (url) {
    try {
      const name = new URL(url).pathname.split("/").pop();
      if (name) return decodeURIComponent(name);
    } catch {
      /* ignore */
    }
  }
  return fallback;
}

/**
 * Slack-style file glyph color. Mirrors Slack's palette so the row icon reads
 * as "PDF" / "doc" / "canvas" at a glance.
 */
export type FileGlyph = {
  /** background fill */
  bg: string;
  /** icon hex (matches inverted contrast on the bg) */
  fg: string;
  /** short label for the icon body */
  label: string;
};

const EXT_TO_GLYPH: Record<string, FileGlyph> = {
  pdf: { bg: "#E01E5A", fg: "#FFFFFF", label: "PDF" },
  doc: { bg: "#1264A3", fg: "#FFFFFF", label: "DOC" },
  docx: { bg: "#1264A3", fg: "#FFFFFF", label: "DOC" },
  txt: { bg: "#4A154B", fg: "#FFFFFF", label: "TXT" },
  csv: { bg: "#2EB67D", fg: "#FFFFFF", label: "CSV" },
  xls: { bg: "#2EB67D", fg: "#FFFFFF", label: "XLS" },
  xlsx: { bg: "#2EB67D", fg: "#FFFFFF", label: "XLS" },
  ppt: { bg: "#E8912D", fg: "#FFFFFF", label: "PPT" },
  pptx: { bg: "#E8912D", fg: "#FFFFFF", label: "PPT" },
  zip: { bg: "#4A154B", fg: "#FFFFFF", label: "ZIP" },
  mp3: { bg: "#36C5F0", fg: "#FFFFFF", label: "MP3" },
  wav: { bg: "#36C5F0", fg: "#FFFFFF", label: "WAV" },
  m4a: { bg: "#36C5F0", fg: "#FFFFFF", label: "M4A" },
};

/** Resolve the best glyph color/label for a file attachment. */
export function glyphFor(a: Attachment): FileGlyph {
  const ext = extOf(a);
  if (ext && EXT_TO_GLYPH[ext]) return EXT_TO_GLYPH[ext];
  if (a.type === "voiceRecording" || a.type === "audio") {
    return { bg: "#36C5F0", fg: "#FFFFFF", label: "AUD" };
  }
  return { bg: "#1264A3", fg: "#FFFFFF", label: "FILE" };
}

function extOf(a: Attachment): string | undefined {
  const fromMime =
    typeof a.mime_type === "string" && a.mime_type.includes("/")
      ? a.mime_type.split("/").pop()
      : undefined;
  if (fromMime) return fromMime.toLowerCase();
  const url = docAssetUrl(a);
  if (!url) return undefined;
  try {
    const path = new URL(url).pathname;
    const dot = path.lastIndexOf(".");
    if (dot === -1) return undefined;
    return path.slice(dot + 1).toLowerCase();
  } catch {
    return undefined;
  }
}
