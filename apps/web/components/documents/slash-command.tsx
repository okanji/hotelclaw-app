"use client";

/**
 * `/` slash command for the document editor — a Notion-style block menu.
 *
 * The headline item is **Sub-page**: it creates a brand-new `documents` row
 * nested under the current doc (via the `createDocument` server action) and
 * drops a `subPage` node (see `sub-page-node.tsx`) where the cursor is, so the
 * in-editor block and the sidebar tree stay in lockstep. The rest are plain
 * block transforms (headings, lists, quote, divider).
 */

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ComponentType,
} from "react";
import {
  Extension,
  ReactRenderer,
  type Editor,
  type Range,
} from "@tiptap/react";
import Suggestion, {
  type SuggestionKeyDownProps,
  type SuggestionProps,
} from "@tiptap/suggestion";
import {
  BarChart3,
  ChevronRight,
  Code,
  ExternalLink,
  FileText,
  FileUp,
  Heading1,
  Heading2,
  Heading3,
  Image as ImageIcon,
  Lightbulb,
  List,
  ListOrdered,
  ListTodo,
  Minus,
  Sparkles,
  Table as TableIcon,
  Table2,
  TextQuote,
  Video,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { detectEmbed } from "@/lib/documents/url-embeds";
import { detectSpreadsheet } from "@/lib/documents/nodes/spreadsheet-embed";
import { createDocument } from "./actions";

export type SlashCommandOptions = {
  /** Property the current document belongs to. */
  propertyId: string;
  /** Current document id — becomes the parent of any sub-page created here. */
  documentId: string;
};

type SlashSection = "ai" | "basic" | "media" | "blocks";

const SECTION_LABEL: Record<SlashSection, string> = {
  ai: "AI",
  basic: "Basic",
  media: "Media",
  blocks: "Blocks",
};

// Render order. The transform on the items array preserves this order so
// each section's items stay in their authored sequence within the section.
const SECTION_ORDER: SlashSection[] = ["ai", "basic", "media", "blocks"];

type SlashItem = {
  title: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  searchTerms: string[];
  section: SlashSection;
  command: (props: { editor: Editor; range: Range }) => void;
};

function buildItems(options: SlashCommandOptions): SlashItem[] {
  return [
    {
      title: "Ask AI",
      description: "Write or edit with AI",
      icon: Sparkles,
      section: "ai",
      searchTerms: ["ai", "ask", "write", "generate", "claw", "edit"],
      command: ({ editor, range }) => {
        // Drop the "/query" text first — its positions go stale, and we want
        // the AI toolbar anchored to a clean cursor, not the slash text.
        editor.chain().focus().deleteRange(range).run();
        // `askAi()` with no arg opens the empty "Ask AI…" prompt box. The
        // command only exists when the `ai` option is configured on
        // useLiveblocksExtension (it is, in document-editor.tsx).
        editor.commands.askAi();
      },
    },
    {
      title: "Sub-page",
      description: "Create a page nested inside this one",
      icon: FileText,
      section: "blocks",
      searchTerms: ["page", "subpage", "child", "nested", "document"],
      command: ({ editor, range }) => {
        // Drop the "/query" text first — its positions go stale once we await.
        editor.chain().focus().deleteRange(range).run();
        const at = editor.state.selection.from;
        void createDocument(options.propertyId, options.documentId).then(
          (res) => {
            if ("error" in res) {
              toast.error(res.error);
              return;
            }
            editor
              .chain()
              .focus()
              .insertContentAt(at, {
                type: "subPage",
                attrs: { documentId: res.id },
              })
              .run();
          },
        );
      },
    },
    {
      title: "Heading 1",
      description: "Large section heading",
      icon: Heading1,
      section: "basic",
      searchTerms: ["h1", "title", "heading", "big"],
      command: ({ editor, range }) =>
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .setNode("heading", { level: 1 })
          .run(),
    },
    {
      title: "Heading 2",
      description: "Medium section heading",
      icon: Heading2,
      section: "basic",
      searchTerms: ["h2", "heading", "subheading"],
      command: ({ editor, range }) =>
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .setNode("heading", { level: 2 })
          .run(),
    },
    {
      title: "Heading 3",
      description: "Small section heading",
      icon: Heading3,
      section: "basic",
      searchTerms: ["h3", "heading", "subheading"],
      command: ({ editor, range }) =>
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .setNode("heading", { level: 3 })
          .run(),
    },
    {
      title: "Bulleted list",
      description: "A simple unordered list",
      icon: List,
      section: "basic",
      searchTerms: ["bullet", "unordered", "ul", "list"],
      command: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).toggleBulletList().run(),
    },
    {
      title: "Numbered list",
      description: "A list with ordering",
      icon: ListOrdered,
      section: "basic",
      searchTerms: ["number", "ordered", "ol", "list"],
      command: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
    },
    {
      title: "To-do list",
      description: "Track tasks with checkboxes",
      icon: ListTodo,
      section: "basic",
      searchTerms: ["todo", "task", "checkbox", "check"],
      command: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).toggleTaskList().run(),
    },
    {
      title: "Quote",
      description: "Capture a quotation",
      icon: TextQuote,
      section: "basic",
      searchTerms: ["quote", "blockquote", "citation"],
      command: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).toggleBlockquote().run(),
    },
    {
      title: "Divider",
      description: "Visually separate sections",
      icon: Minus,
      section: "basic",
      searchTerms: ["divider", "rule", "separator", "hr", "line"],
      command: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).setHorizontalRule().run(),
    },
    {
      title: "Table",
      description: "Insert a 3×3 table with a header row",
      icon: TableIcon,
      section: "blocks",
      searchTerms: ["table", "grid", "rows", "columns"],
      command: ({ editor, range }) =>
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
          .run(),
    },
    {
      title: "Code block",
      description: "Code with syntax highlighting",
      icon: Code,
      section: "basic",
      searchTerms: ["code", "snippet", "highlight", "syntax", "pre"],
      command: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).toggleCodeBlock().run(),
    },
    {
      title: "Callout",
      description: "Highlighted note with an icon",
      icon: Lightbulb,
      section: "blocks",
      searchTerms: ["callout", "note", "info", "tip", "warning", "box"],
      command: ({ editor, range }) =>
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .insertContent({
            type: "callout",
            attrs: { variant: "info", icon: "💡" },
            content: [],
          })
          .run(),
    },
    {
      title: "Toggle",
      description: "Collapsible section with hidden body",
      icon: ChevronRight,
      section: "blocks",
      searchTerms: ["toggle", "collapse", "fold", "expand", "details"],
      command: ({ editor, range }) =>
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .insertContent({
            type: "toggle",
            attrs: { open: true },
            content: [
              { type: "paragraph" },
              { type: "paragraph" },
            ],
          })
          .run(),
    },
    {
      title: "Image",
      description: "Upload an image",
      icon: ImageIcon,
      section: "media",
      searchTerms: ["image", "img", "picture", "photo", "upload"],
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).run();
        const insertAt = editor.state.selection.from;
        void pickAndUploadImage(options).then((url) => {
          if (!url) return;
          editor
            .chain()
            .focus()
            .insertContentAt(insertAt, {
              type: "image",
              attrs: { src: url },
            })
            .run();
        });
      },
    },
    {
      title: "Video",
      description: "Embed a YouTube video by URL",
      icon: Video,
      section: "media",
      searchTerms: ["video", "youtube", "yt", "embed"],
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).run();
        const raw = window.prompt("Paste a YouTube URL:");
        if (!raw) return;
        editor.chain().focus().setYoutubeVideo({ src: raw }).run();
      },
    },
    {
      title: "File / PDF",
      description: "Upload an attachment or PDF",
      icon: FileUp,
      section: "media",
      searchTerms: ["file", "pdf", "upload", "attachment", "doc", "audio", "video", "zip"],
      command: ({ editor, range }) => {
        // Drop the "/query" first so the upload doesn't race a stale range.
        editor.chain().focus().deleteRange(range).run();
        const insertAt = editor.state.selection.from;
        void pickAndUploadFile(options).then((res) => {
          if (!res) return;
          editor
            .chain()
            .focus()
            .insertContentAt(insertAt, {
              type: "fileAttachment",
              attrs: {
                url: res.url,
                name: res.name,
                size: res.size,
                mimeType: res.type,
              },
            })
            .run();
        });
      },
    },
    {
      title: "Chart",
      description: "Editable bar / line / pie / area chart",
      icon: BarChart3,
      section: "blocks",
      searchTerms: ["chart", "graph", "bar", "line", "pie", "area", "data", "visualisation", "visualization"],
      command: ({ editor, range }) =>
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .insertContent({
            type: "chart",
            attrs: {
              type: "bar",
              title: "",
              data: {
                headers: ["Category", "Value"],
                rows: [
                  ["A", "10"],
                  ["B", "20"],
                  ["C", "15"],
                  ["D", "30"],
                ],
              },
            },
          })
          .run(),
    },
    {
      title: "Spreadsheet",
      description: "Embed a Google Sheet or Excel Online workbook",
      icon: Table2,
      section: "media",
      searchTerms: ["spreadsheet", "sheet", "excel", "google sheets", "xlsx", "sheets"],
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).run();
        const insertAt = editor.state.selection.from;
        const raw = window.prompt(
          "Paste a Google Sheets or Excel Online URL (the sheet must be shared/published):",
        );
        if (!raw) return;
        const target = detectSpreadsheet(raw);
        if (!target) {
          toast.error(
            "That URL isn't a Google Sheet or Excel Online workbook. Make sure the sheet is published to the web.",
          );
          return;
        }
        editor
          .chain()
          .focus()
          .insertContentAt(insertAt, {
            type: "spreadsheetEmbed",
            attrs: { url: target.url, provider: target.provider },
          })
          .run();
      },
    },
    {
      title: "Embed",
      description: "YouTube, Figma, Loom, Twitter, Spotify, or a bookmark",
      icon: ExternalLink,
      section: "media",
      searchTerms: ["embed", "youtube", "vimeo", "loom", "figma", "tweet", "twitter", "x", "spotify", "codepen", "bookmark", "link"],
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).run();
        const insertAt = editor.state.selection.from;
        const raw = window.prompt("Paste a URL (YouTube, Figma, Loom, Twitter, etc.):");
        if (!raw) return;
        const target = detectEmbed(raw);
        const baseAttrs: Record<string, unknown> = {
          url: raw,
          kind: target.kind,
        };
        if ("embedUrl" in target) baseAttrs.embedUrl = target.embedUrl;
        if ("tweetId" in target) baseAttrs.tweetId = target.tweetId;

        // For known providers we can insert immediately; for bookmarks we
        // fetch og:meta first so the card has a title/image/description.
        if (target.kind !== "bookmark") {
          editor
            .chain()
            .focus()
            .insertContentAt(insertAt, { type: "embed", attrs: baseAttrs })
            .run();
          return;
        }
        void fetch(
          `/api/documents/og-preview?url=${encodeURIComponent(raw)}`,
        )
          .then((r) => r.json())
          .then((meta: {
            title?: string;
            description?: string;
            image?: string;
            siteName?: string;
          }) => {
            editor
              .chain()
              .focus()
              .insertContentAt(insertAt, {
                type: "embed",
                attrs: {
                  ...baseAttrs,
                  title: meta.title ?? null,
                  description: meta.description ?? null,
                  image: meta.image ?? null,
                  siteName: meta.siteName ?? null,
                },
              })
              .run();
          })
          .catch(() => {
            editor
              .chain()
              .focus()
              .insertContentAt(insertAt, { type: "embed", attrs: baseAttrs })
              .run();
          });
      },
    },
  ];
}

/** Open a hidden image picker, upload, return the public URL or null. */
async function pickAndUploadImage(
  options: SlashCommandOptions,
): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg,image/webp,image/gif,image/svg+xml";
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      const form = new FormData();
      form.append("file", file);
      try {
        const res = await fetch(
          `/api/documents/images/upload?propertyId=${options.propertyId}&documentId=${options.documentId}`,
          { method: "POST", body: form },
        );
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as { error?: string };
          toast.error(err.error ?? `Upload failed (${res.status})`);
          resolve(null);
          return;
        }
        const body = (await res.json()) as { url: string };
        resolve(body.url);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Upload failed");
        resolve(null);
      }
    });
    input.click();
  });
}

/** Open a hidden file picker, upload the selected file, return the metadata.
 *  Returns null if the user cancelled or the upload failed (toast already shown). */
async function pickAndUploadFile(
  options: SlashCommandOptions,
): Promise<{ url: string; name: string; size: number; type: string } | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.md,.json,.zip,.mp3,.m4a,.wav,.mp4,.webm,.mov";
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      const form = new FormData();
      form.append("file", file);
      try {
        const res = await fetch(
          `/api/documents/files/upload?propertyId=${options.propertyId}&documentId=${options.documentId}`,
          { method: "POST", body: form },
        );
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as { error?: string };
          toast.error(err.error ?? `Upload failed (${res.status})`);
          resolve(null);
          return;
        }
        const body = (await res.json()) as {
          url: string;
          name: string;
          size: number;
          type: string;
        };
        resolve(body);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Upload failed");
        resolve(null);
      }
    });
    input.click();
  });
}

function filterItems(items: SlashItem[], query: string): SlashItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter(
    (item) =>
      item.title.toLowerCase().includes(q) ||
      item.searchTerms.some((term) => term.includes(q)),
  );
}

// ── Menu component ──────────────────────────────────────────────────────────

type SlashMenuProps = {
  items: SlashItem[];
  command: (item: SlashItem) => void;
};

type SlashMenuHandle = {
  onKeyDown: (event: KeyboardEvent) => boolean;
};

const SlashMenu = forwardRef<SlashMenuHandle, SlashMenuProps>(
  function SlashMenu({ items, command }, ref) {
    const [selected, setSelected] = useState(0);
    const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

    useEffect(() => setSelected(0), [items]);
    useEffect(() => {
      itemRefs.current[selected]?.scrollIntoView({ block: "nearest" });
    }, [selected]);

    useImperativeHandle(
      ref,
      () => ({
        onKeyDown: (event) => {
          if (items.length === 0) return false;
          if (event.key === "ArrowDown") {
            setSelected((s) => (s + 1) % items.length);
            return true;
          }
          if (event.key === "ArrowUp") {
            setSelected((s) => (s - 1 + items.length) % items.length);
            return true;
          }
          if (event.key === "Enter") {
            const item = items[selected];
            if (item) command(item);
            return true;
          }
          return false;
        },
      }),
      [items, selected, command],
    );

    if (items.length === 0) {
      return (
        <div className="w-72 rounded-lg border border-border bg-popover px-3 py-2 text-sm text-muted-foreground shadow-md">
          No matching blocks
        </div>
      );
    }

    // Group items by section while preserving their authored order. The
    // outer `items` array is the keyboard-navigation index; rendering
    // groups it visually without shuffling that index.
    const groups: { section: SlashSection; items: { item: SlashItem; index: number }[] }[] = [];
    items.forEach((item, index) => {
      const last = groups[groups.length - 1];
      if (last && last.section === item.section) {
        last.items.push({ item, index });
      } else {
        groups.push({ section: item.section, items: [{ item, index }] });
      }
    });
    // Stable sort groups so multiple matches of the same section coalesce
    // into one visual block at their first occurrence's position.
    groups.sort(
      (a, b) =>
        SECTION_ORDER.indexOf(a.section) - SECTION_ORDER.indexOf(b.section),
    );

    return (
      <div className="max-h-80 w-72 overflow-y-auto rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md">
        {groups.map(({ section, items: groupItems }) => (
          <div key={section}>
            <div className="px-2 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {SECTION_LABEL[section]}
            </div>
            {groupItems.map(({ item, index }) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.title}
                  type="button"
                  ref={(el) => {
                    itemRefs.current[index] = el;
                  }}
                  onClick={() => command(item)}
                  onMouseEnter={() => setSelected(index)}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left",
                    index === selected && "bg-accent text-accent-foreground",
                  )}
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-background">
                    <Icon className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {item.title}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {item.description}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    );
  },
);

// ── Suggestion popup plumbing ───────────────────────────────────────────────

function positionElement(el: HTMLElement, rect: DOMRect | null | undefined) {
  if (!rect) return;
  el.style.position = "fixed";
  el.style.zIndex = "60";
  const height = el.offsetHeight || 320;
  const spaceBelow = window.innerHeight - rect.bottom;
  const flip = spaceBelow < height + 12;
  el.style.left = `${Math.round(rect.left)}px`;
  el.style.top = flip
    ? `${Math.round(Math.max(8, rect.top - height - 6))}px`
    : `${Math.round(rect.bottom + 6)}px`;
}

function createRenderer() {
  let renderer: ReactRenderer<SlashMenuHandle, SlashMenuProps> | null = null;

  return {
    onStart: (props: SuggestionProps<SlashItem>) => {
      renderer = new ReactRenderer(SlashMenu, {
        props: { items: props.items, command: props.command },
        editor: props.editor,
      });
      document.body.appendChild(renderer.element);
      positionElement(renderer.element as HTMLElement, props.clientRect?.());
    },
    onUpdate: (props: SuggestionProps<SlashItem>) => {
      if (!renderer) return;
      renderer.updateProps({ items: props.items, command: props.command });
      const el = renderer.element as HTMLElement;
      el.style.display = "";
      positionElement(el, props.clientRect?.());
    },
    onKeyDown: (props: SuggestionKeyDownProps) => {
      if (!renderer) return false;
      if (props.event.key === "Escape") {
        (renderer.element as HTMLElement).style.display = "none";
        return true;
      }
      return renderer.ref?.onKeyDown(props.event) ?? false;
    },
    onExit: () => {
      renderer?.element.remove();
      renderer?.destroy();
      renderer = null;
    },
  };
}

// ── Extension ───────────────────────────────────────────────────────────────

export const SlashCommand = Extension.create<SlashCommandOptions>({
  name: "slashCommand",

  addOptions() {
    return { propertyId: "", documentId: "" };
  },

  addProseMirrorPlugins() {
    const options = this.options;
    return [
      Suggestion<SlashItem>({
        editor: this.editor,
        char: "/",
        // Never offer block transforms on the title (the first top-level node).
        allow: ({ state }) => {
          try {
            return state.selection.$from.before(1) !== 0;
          } catch {
            return true;
          }
        },
        items: ({ query }) => filterItems(buildItems(options), query),
        command: ({ editor, range, props }) => {
          props.command({ editor, range });
        },
        render: createRenderer,
      }),
    ];
  },
});
