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
  FileText,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  ListTodo,
  Minus,
  TextQuote,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { createDocument } from "./actions";

export type SlashCommandOptions = {
  /** Property the current document belongs to. */
  propertyId: string;
  /** Current document id — becomes the parent of any sub-page created here. */
  documentId: string;
};

type SlashItem = {
  title: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  searchTerms: string[];
  command: (props: { editor: Editor; range: Range }) => void;
};

function buildItems(options: SlashCommandOptions): SlashItem[] {
  return [
    {
      title: "Sub-page",
      description: "Create a page nested inside this one",
      icon: FileText,
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
      searchTerms: ["bullet", "unordered", "ul", "list"],
      command: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).toggleBulletList().run(),
    },
    {
      title: "Numbered list",
      description: "A list with ordering",
      icon: ListOrdered,
      searchTerms: ["number", "ordered", "ol", "list"],
      command: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
    },
    {
      title: "To-do list",
      description: "Track tasks with checkboxes",
      icon: ListTodo,
      searchTerms: ["todo", "task", "checkbox", "check"],
      command: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).toggleTaskList().run(),
    },
    {
      title: "Quote",
      description: "Capture a quotation",
      icon: TextQuote,
      searchTerms: ["quote", "blockquote", "citation"],
      command: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).toggleBlockquote().run(),
    },
    {
      title: "Divider",
      description: "Visually separate sections",
      icon: Minus,
      searchTerms: ["divider", "rule", "separator", "hr", "line"],
      command: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).setHorizontalRule().run(),
    },
  ];
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

    return (
      <div className="max-h-80 w-72 overflow-y-auto rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md">
        {items.map((item, index) => {
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
