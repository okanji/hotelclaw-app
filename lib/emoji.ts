import emojiData from "@emoji-mart/data";

type EmojiDataShape = {
  emojis: Record<
    string,
    {
      id: string;
      name: string;
      skins?: Array<{ native?: string; unified?: string }>;
    }
  >;
};

const DATA = emojiData as unknown as EmojiDataShape;

/**
 * Returns the native unicode glyph for an emoji-mart id (e.g. "fire" → "🔥").
 *
 * Stream Chat stores reactions by `type` (a string). Sending native unicode
 * glyphs as the type doesn't reliably round-trip on `channel.watch()` — the
 * reaction appears optimistically but isn't there after a refresh. Stream-safe
 * practice is to use ASCII identifiers as the reaction type and look up the
 * displayed glyph at render time. This helper is that lookup.
 *
 * Falls back to returning the input unchanged so legacy reaction types
 * ("haha", "thumbsup", etc. — already in Stream's defaultReactionOptions) and
 * any native glyph stored from older messages still render *something*.
 */
export function getEmojiNative(idOrNative: string): string {
  const entry = DATA.emojis[idOrNative];
  return entry?.skins?.[0]?.native ?? idOrNative;
}
