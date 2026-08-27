"use client";

/**
 * Plain-text renderer for a bot bubble that is still receiving stream
 * chunks: each newly-arrived word resolves out of a slight blur
 * (`ai-blur-in`, defined in app/globals.css — reduced-motion safe)
 * while the already-shown prefix stays perfectly still.
 *
 * Why the prefix never re-animates: every word span carries the class
 * permanently, and spans are keyed by token index over an APPEND-ONLY
 * text (the guest stream only ever grows the tail). React therefore
 * reuses the existing DOM nodes on each chunk's re-render, and a CSS
 * animation only plays when its node first mounts — so old words sit
 * still and exactly the new tokens blur in. The bubble itself is keyed
 * by message id, so tracking is per message for free.
 *
 * Markdown parsing is deliberately deferred until the stream settles —
 * re-parsing markdown on every chunk is what repaints the whole bubble.
 * The parent swaps this out for ChatMarkdown once `streaming` clears;
 * the plain→markdown jump is minor (same font and size) and accepted.
 */
export function StreamingText({ text }: { text: string }) {
  // Keep whitespace tokens (split with a capture group) so newlines and
  // spacing survive under whitespace-pre-wrap.
  const tokens = text.split(/(\s+)/);
  return (
    <span className="whitespace-pre-wrap">
      {tokens.map((token, i) =>
        /^\s*$/.test(token) ? (
          token
        ) : (
          <span key={i} className="ai-blur-in inline-block">
            {token}
          </span>
        ),
      )}
    </span>
  );
}
