"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/utils";

export type MentionContext = {
  query: string;
  // DOM range that spans the `@query` token so we can replace it cleanly.
  range: Range;
};

export type RichEditorHandle = {
  focus: () => void;
  blur: () => void;
  /** Execute a formatting command (bold/italic/etc.) at the current selection. */
  format: (
    command:
      | "bold"
      | "italic"
      | "underline"
      | "strikeThrough"
      | "insertOrderedList"
      | "insertUnorderedList"
      | "formatBlock",
    value?: string,
  ) => void;
  /** Wrap selection (or insert template when empty) — used for templated text inserts. */
  wrapSelection: (prefix: string, suffix?: string, placeholder?: string) => void;
  /** Wrap the current selection in `<code>` for inline code. */
  inlineCode: () => void;
  /** Convert the current block to a `<pre>` code block. */
  codeBlock: () => void;
  /** Insert a hyperlink at the current selection. */
  insertLink: (url: string, displayText?: string) => void;
  /** Insert literal text at the caret. */
  insertText: (text: string) => void;
  /** Replace a range with text (used when selecting a mention from the popover). */
  replaceRange: (range: Range, replacement: string) => void;
  /** Replace a range with a styled, atomic mention chip — the visual pill the
   *  user sees in the composer. `display` is the rendered text (e.g. "alice");
   *  `id` is the Stream user id stored on the chip and serialized as `@id`. */
  replaceRangeWithMention: (
    range: Range,
    spec: { id: string; display: string; isBroadcast?: boolean },
  ) => void;
  /** Derive the set of mention ids currently present in the editor — source
   *  of truth for `mentioned_users` at send time, so deleting a chip in the
   *  composer correctly drops the user from the outgoing message. */
  getMentionedIds: () => string[];
  /** Read the editor content as markdown for sending. */
  getMarkdown: () => string;
  /** True when the editor is visually empty. */
  isEmpty: () => boolean;
  /** Clear all content. */
  clear: () => void;
};

type Props = {
  placeholder?: string;
  onSubmit?: () => void;
  onChange?: () => void;
  onMentionContextChange?: (ctx: MentionContext | null) => void;
  /** Called with clipboard files (pasted screenshots, files copied from the
   *  OS file manager) so the composer can stage them as attachments instead
   *  of silently dropping them. */
  onPasteFiles?: (files: File[]) => void;
  /** Keys to ignore (caller may handle them, e.g. when a popover is open). */
  shouldYieldKey?: (e: React.KeyboardEvent) => boolean;
  className?: string;
};

/**
 * contentEditable wrapper that renders rich text WYSIWYG (bold shows bold,
 * lists show bullets, etc.) and serializes to markdown for sending. Built on
 * the legacy `document.execCommand` API — deprecated but the only cross-
 * browser zero-dependency option. Good enough for chat input where the
 * required commands (bold/italic/u/strike/lists) are all well-supported.
 */
export const RichEditor = forwardRef<RichEditorHandle, Props>(function RichEditor(
  {
    placeholder,
    onSubmit,
    onChange,
    onMentionContextChange,
    onPasteFiles,
    shouldYieldKey,
    className,
  },
  ref,
) {
  const elRef = useRef<HTMLDivElement>(null);
  const [isEmpty, setIsEmpty] = useState(true);

  useImperativeHandle(ref, () => ({
    focus: () => elRef.current?.focus(),
    blur: () => elRef.current?.blur(),
    format: (command, value) => {
      const el = elRef.current;
      if (!el) return;
      el.focus();
      // Commands like `insertOrderedList` / `insertUnorderedList` /
      // `formatBlock` restructure the DOM and Chromium collapses the caret
      // to the start of the new block — annoying when the user just typed a
      // word. Capture the text-offset before the command and restore it
      // after. Only when the selection is collapsed; if the user has a
      // range selected, leave it alone.
      const sel = window.getSelection();
      let savedOffset: number | null = null;
      if (sel && sel.rangeCount > 0 && sel.isCollapsed) {
        const range = sel.getRangeAt(0);
        if (el.contains(range.startContainer)) {
          const probe = document.createRange();
          probe.setStart(el, 0);
          probe.setEnd(range.startContainer, range.startOffset);
          savedOffset = probe.toString().length;
        }
      }
      document.execCommand(command, false, value);
      if (savedOffset !== null) {
        const restored = makeRangeFromTextOffset(el, savedOffset, savedOffset);
        if (restored) {
          const after = window.getSelection();
          after?.removeAllRanges();
          after?.addRange(restored);
        }
      }
      emit();
    },
    wrapSelection: (prefix, suffix = prefix, placeholderText = "text") => {
      const el = elRef.current;
      if (!el) return;
      el.focus();
      const sel = window.getSelection();
      const range = sel?.rangeCount ? sel.getRangeAt(0) : null;
      const selectedText = range?.toString() ?? "";
      const insert = `${prefix}${selectedText || placeholderText}${suffix}`;
      document.execCommand("insertText", false, insert);
      emit();
    },
    inlineCode: () => {
      const el = elRef.current;
      if (!el) return;
      el.focus();
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);
      const selected = range.toString();
      const code = document.createElement("code");
      code.textContent = selected || "code";
      range.deleteContents();
      range.insertNode(code);
      const after = document.createRange();
      after.setStartAfter(code);
      after.collapse(true);
      sel.removeAllRanges();
      sel.addRange(after);
      emit();
    },
    codeBlock: () => {
      const el = elRef.current;
      if (!el) return;
      el.focus();
      // Wrap the current block in <pre>. Browsers handle this differently
      // when the block has nested inline formatting — `formatBlock` is the
      // closest standard primitive and works in current Chromium/Safari.
      document.execCommand("formatBlock", false, "pre");
      emit();
    },
    insertLink: (url, displayText) => {
      const el = elRef.current;
      if (!el) return;
      el.focus();
      const sel = window.getSelection();
      const selected = sel?.toString() ?? "";
      const text = selected || displayText || url;
      // execCommand("createLink") only works when there's a selection; if
      // empty we insert the display text first and then link it.
      if (!selected) {
        document.execCommand("insertText", false, text);
        // Move the selection back over the inserted text so createLink wraps it.
        const newSel = window.getSelection();
        if (newSel && newSel.anchorNode) {
          const r = document.createRange();
          const node = newSel.anchorNode;
          const offset = newSel.anchorOffset;
          r.setStart(node, Math.max(offset - text.length, 0));
          r.setEnd(node, offset);
          newSel.removeAllRanges();
          newSel.addRange(r);
        }
      }
      document.execCommand("createLink", false, url);
      // Collapse selection to the end so the user can keep typing
      const after = window.getSelection();
      if (after && after.rangeCount > 0) after.collapseToEnd();
      emit();
    },
    insertText: (text) => {
      elRef.current?.focus();
      document.execCommand("insertText", false, text);
      emit();
    },
    replaceRange: (range, replacement) => {
      const sel = window.getSelection();
      if (!sel) return;
      sel.removeAllRanges();
      sel.addRange(range);
      document.execCommand("insertText", false, replacement);
      emit();
    },
    replaceRangeWithMention: (range, { id, display, isBroadcast }) => {
      const el = elRef.current;
      if (!el) return;
      const sel = window.getSelection();
      if (!sel) return;

      // Build the atomic chip. `contenteditable=false` makes the chip behave
      // as a single grapheme — left/right arrow steps over it, backspace
      // deletes it whole. The trailing space (a real text node, outside the
      // chip) gives the caret somewhere to land afterwards so the user can
      // keep typing.
      const chip = document.createElement("span");
      chip.className = "str-chat__message-mention";
      chip.setAttribute("data-user-id", id);
      chip.setAttribute("data-mention", "true");
      if (isBroadcast) chip.setAttribute("data-broadcast", "true");
      chip.setAttribute("contenteditable", "false");
      chip.textContent = `@${display}`;
      const trailing = document.createTextNode(" ");

      sel.removeAllRanges();
      sel.addRange(range);
      range.deleteContents();
      range.insertNode(trailing);
      range.insertNode(chip);

      // Return focus to the editor before placing the caret — when the
      // mention was picked by mouse, focus is on the popover item, and the
      // popover is configured not to restore focus on close (finalFocus=
      // false) so it doesn't fight us. Without this the caret would be set
      // on an unfocused editor and the user couldn't keep typing.
      el.focus();
      const caret = document.createRange();
      caret.setStartAfter(trailing);
      caret.collapse(true);
      sel.removeAllRanges();
      sel.addRange(caret);

      emit();
    },
    getMentionedIds: () => {
      const el = elRef.current;
      if (!el) return [];
      const seen = new Set<string>();
      el
        .querySelectorAll<HTMLElement>('[data-mention="true"]')
        .forEach((node) => {
          if (node.getAttribute("data-broadcast") === "true") return;
          const id = node.getAttribute("data-user-id");
          if (id) seen.add(id);
        });
      return [...seen];
    },
    getMarkdown: () => htmlToMarkdown(elRef.current?.innerHTML ?? ""),
    isEmpty: () => editorIsEmpty(elRef.current),
    clear: () => {
      if (elRef.current) elRef.current.innerHTML = "";
      setIsEmpty(true);
      onChange?.();
      onMentionContextChange?.(null);
    },
  }));

  function emit() {
    const empty = editorIsEmpty(elRef.current);
    setIsEmpty(empty);
    onChange?.();
    onMentionContextChange?.(readMentionContext(elRef.current));
  }

  function onInput() {
    emit();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (shouldYieldKey?.(e)) return;
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        const li = findParentTag(range.startContainer, "LI");
        if (li && elRef.current?.contains(li)) {
          // Inside a list — handle Enter ourselves so it always works
          // regardless of what nested formatting the line carries. Chromium's
          // native behavior with execCommand-created lists is unreliable when
          // the line has multiple inline format wrappers.
          e.preventDefault();
          if (isEmptyLi(li)) {
            exitListItem(li);
          } else {
            splitListItem(li, range);
          }
          emit();
          return;
        }
      }
      e.preventDefault();
      onSubmit?.();
    }
  }

  function onPaste(e: React.ClipboardEvent<HTMLDivElement>) {
    // Clipboard files (a pasted screenshot, files copied from Finder /
    // Explorer) become attachments, matching Slack. When files are present
    // any accompanying text/html is decoration (e.g. an <img> tag mirroring
    // the screenshot) — attach the files and insert nothing.
    const files = Array.from(e.clipboardData.files);
    if (files.length > 0 && onPasteFiles) {
      e.preventDefault();
      onPasteFiles(files);
      return;
    }
    // Force plain text on paste — keeps the editor from inheriting messy
    // styles from the source (Word, web pages).
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain");
    document.execCommand("insertText", false, text);
    emit();
  }

  // Track selection moves (arrow keys, clicks) so the mention popover
  // updates even without an input event.
  useEffect(() => {
    function onSelChange() {
      if (!elRef.current) return;
      if (!document.activeElement || !elRef.current.contains(document.activeElement)) return;
      onMentionContextChange?.(readMentionContext(elRef.current));
    }
    document.addEventListener("selectionchange", onSelChange);
    return () => document.removeEventListener("selectionchange", onSelChange);
  }, [onMentionContextChange]);

  return (
    <div className="relative">
      {isEmpty && placeholder ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 select-none text-base leading-[1.45] text-muted-foreground/80"
        >
          {placeholder}
        </span>
      ) : null}
      <div
        ref={elRef}
        role="textbox"
        aria-label={placeholder ?? "Message"}
        aria-multiline="true"
        contentEditable
        suppressContentEditableWarning
        onInput={onInput}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        className={cn(
          "rich-editor-content block min-h-[24px] w-full whitespace-pre-wrap break-words text-base leading-[1.45] text-foreground outline-none focus:outline-none focus-visible:outline-none",
          "[&_a]:text-primary-ink [&_a]:underline",
          "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-sm",
          "[&_pre]:my-1 [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:px-2.5 [&_pre]:py-2 [&_pre]:font-mono [&_pre]:text-sm [&_pre]:whitespace-pre-wrap [&_pre_code]:bg-transparent [&_pre_code]:p-0",
          "[&_blockquote]:my-0 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-2 [&_blockquote]:text-muted-foreground",
          className,
        )}
      />
    </div>
  );
});

// ─────────────────────────────────────────────────────────────────────────────

function editorIsEmpty(el: HTMLDivElement | null): boolean {
  if (!el) return true;
  // Browsers stick a stray <br> in an empty contentEditable.
  const html = el.innerHTML.trim();
  if (html === "" || html === "<br>" || html === "<div><br></div>") return true;
  return (el.textContent ?? "").trim() === "";
}

function findParentTag(node: Node | null, tag: string): Element | null {
  let n: Node | null = node;
  while (n) {
    if (n.nodeType === Node.ELEMENT_NODE && (n as Element).tagName === tag) {
      return n as Element;
    }
    n = n.parentNode;
  }
  return null;
}

function isEmptyLi(li: Element): boolean {
  const text = (li.textContent ?? "").replace(/​/g, "").trim();
  return text === "";
}

/**
 * Split a list item at the caret. Everything after the caret moves into a
 * new sibling `<li>`; the caret lands at the start of the new item.
 */
function splitListItem(li: Element, range: Range) {
  const list = li.parentElement;
  if (!list) return;

  // Slice off content after the caret. Build a Range from the caret to the
  // end of the current li, extract its contents, and stick them in a new li.
  const tail = document.createRange();
  tail.setStart(range.startContainer, range.startOffset);
  tail.setEndAfter(li.lastChild ?? li);
  const fragment = tail.extractContents();

  const newLi = document.createElement("li");
  if (fragment.childNodes.length === 0 || !fragment.textContent) {
    // No tail content — leave a <br> so the new li renders at full height
    // and the caret has somewhere to land.
    newLi.appendChild(document.createElement("br"));
  } else {
    newLi.appendChild(fragment);
  }
  li.after(newLi);

  const sel = window.getSelection();
  if (!sel) return;
  const caret = document.createRange();
  caret.setStart(newLi, 0);
  caret.collapse(true);
  sel.removeAllRanges();
  sel.addRange(caret);
}

/**
 * Caller used Enter on an empty `<li>` — exit the list. Insert a paragraph
 * after the parent list, drop the empty item, place the caret in the new
 * paragraph. Matches Slack/Notion behavior.
 */
function exitListItem(li: Element) {
  const list = li.parentElement;
  if (!list) return;
  const after = document.createElement("div");
  after.appendChild(document.createElement("br"));
  list.after(after);
  li.remove();
  // If that was the only item, drop the empty list shell too.
  if (!list.querySelector("li")) list.remove();
  const sel = window.getSelection();
  if (!sel) return;
  const caret = document.createRange();
  caret.setStart(after, 0);
  caret.collapse(true);
  sel.removeAllRanges();
  sel.addRange(caret);
}

/**
 * Returns the active mention context — the `@query` token immediately before
 * the caret — or null if the caret isn't sitting in a mention trigger.
 */
function readMentionContext(el: HTMLDivElement | null): MentionContext | null {
  if (!el) return null;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!range.collapsed) return null;
  if (!el.contains(range.startContainer)) return null;

  // Walk back through text characters in the same line (within the editor)
  // until we hit whitespace or an @ that starts the trigger.
  const probe = document.createRange();
  probe.setStart(el, 0);
  probe.setEnd(range.startContainer, range.startOffset);
  const textBefore = probe.toString();

  // Find the last @ that's at start-of-text or preceded by whitespace.
  let atIdx = -1;
  for (let i = textBefore.length - 1; i >= 0; i--) {
    const ch = textBefore[i];
    if (ch === "@") {
      const prev = i === 0 ? " " : textBefore[i - 1];
      if (/\s/.test(prev)) {
        atIdx = i;
        break;
      }
    }
    if (/\s/.test(ch)) break;
  }
  if (atIdx === -1) return null;
  const query = textBefore.slice(atIdx + 1).toLowerCase();
  if (query.length > 30) return null;

  // Build a Range that spans the `@query` token so the caller can replace it.
  const tokenRange = makeRangeFromTextOffset(el, atIdx, textBefore.length);
  if (!tokenRange) return null;
  return { query, range: tokenRange };
}

/**
 * Walks the editor's text nodes to build a Range that starts at character
 * offset `start` and ends at character offset `end` (where offsets are
 * measured against `el.textContent`).
 */
function makeRangeFromTextOffset(
  el: HTMLElement,
  start: number,
  end: number,
): Range | null {
  const range = document.createRange();
  let pos = 0;
  let startSet = false;
  let endSet = false;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
  let node = walker.nextNode();
  while (node) {
    const text = node.nodeValue ?? "";
    const next = pos + text.length;
    if (!startSet && start >= pos && start <= next) {
      range.setStart(node, start - pos);
      startSet = true;
    }
    if (!endSet && end >= pos && end <= next) {
      range.setEnd(node, end - pos);
      endSet = true;
      break;
    }
    pos = next;
    node = walker.nextNode();
  }
  return startSet && endSet ? range : null;
}

// ── HTML → Markdown ─────────────────────────────────────────────────────────

/**
 * Convert the editor's rendered HTML to chat markdown. Supports the subset
 * Stream and our message renderer understand: bold/italic/underline/strike,
 * inline + block code, blockquote, ordered + unordered lists, links.
 */
function htmlToMarkdown(html: string): string {
  if (!html) return "";
  const tmp = document.createElement("div");
  tmp.innerHTML = html;
  const out = nodeToMarkdown(tmp).replace(/\n{3,}/g, "\n\n");
  return out.trim();
}

function nodeToMarkdown(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ?? "";
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const el = node as Element;
  const inner = () =>
    Array.from(el.childNodes).map(nodeToMarkdown).join("");

  switch (el.tagName) {
    case "B":
    case "STRONG":
      return `**${inner()}**`;
    case "I":
    case "EM":
      return `*${inner()}*`;
    case "U":
      return `<u>${inner()}</u>`;
    case "S":
    case "STRIKE":
    case "DEL":
      return `~~${inner()}~~`;
    case "A": {
      const href = (el as HTMLAnchorElement).getAttribute("href") ?? "";
      return `[${inner()}](${href})`;
    }
    case "CODE":
      if (el.parentElement?.tagName === "PRE") return inner();
      return `\`${inner()}\``;
    case "PRE":
      return "\n```\n" + inner() + "\n```\n";
    case "BLOCKQUOTE":
      return inner()
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
    case "UL":
      return (
        "\n" +
        Array.from(el.children)
          .map((li) => `- ${nodeToMarkdown(li)}`)
          .join("\n") +
        "\n"
      );
    case "OL": {
      const start = parseInt(
        (el as HTMLOListElement).getAttribute("start") ?? "1",
        10,
      );
      return (
        "\n" +
        Array.from(el.children)
          .map((li, i) => `${start + i}. ${nodeToMarkdown(li)}`)
          .join("\n") +
        "\n"
      );
    }
    case "LI":
      return inner().replace(/\n+$/, "");
    case "BR":
      return "\n";
    case "DIV":
    case "P": {
      const content = inner();
      // Browsers wrap each line in a <div> in contentEditable. Add a single
      // newline after each so lines are separated, but never double up.
      return content + (content.endsWith("\n") ? "" : "\n");
    }
    case "SPAN": {
      // Mention chips serialize to plain `@token` text so Stream's renderer
      // matches them against `mentioned_users` on the receiver. The chip's
      // text content already starts with `@` so `inner()` is correct here —
      // the explicit branch is for clarity and to make the contract obvious.
      if ((el as HTMLElement).getAttribute("data-mention") === "true") {
        return inner();
      }
      return inner();
    }
    default:
      return inner();
  }
}
