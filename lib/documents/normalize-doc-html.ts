/**
 * Normalize model-produced document HTML before diffing / inserting.
 * LLMs often emit runs of empty <p></p> between sections; each becomes a
 * full-height block in Tiptap and looks like a huge gap in the editor.
 */

/** Remove empty paragraphs and excess newlines between block tags. */
export function collapseEmptyDocParagraphs(html: string): string {
  return html
    .replace(/<p>\s*(?:<br\s*\/?>)?\s*<\/p>/gi, "")
    .replace(
      /(<\/(?:p|h[1-3]|li|blockquote|ul|ol)>)\s*(?:<p>\s*(?:<br\s*\/?>)?\s*<\/p>\s*)+(<(?:p|h[1-3]|ul|ol|li|blockquote))/gi,
      "$1$2",
    )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
