"use client";

/**
 * Keyboard-shortcut help modal. Opens on `?` when no cell is in edit mode.
 * Pure UI — the actual shortcut handlers live in `sheet-surface.tsx`.
 */

import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

const SHORTCUTS: Array<{ section: string; rows: Array<[string, string]> }> = [
  {
    section: "Navigation",
    rows: [
      ["Arrow keys", "Move selection"],
      ["Shift + Arrow", "Extend selection"],
      ["Tab / Shift+Tab", "Move right / left"],
      ["Enter", "Start editing the active cell"],
      ["Shift+Enter", "Commit edit & move up"],
      ["Cmd/Ctrl + A", "Select all"],
    ],
  },
  {
    section: "Editing",
    rows: [
      ["Type a key on a selected cell", "Start editing with that key"],
      ["Esc", "Cancel edit / clear format painter"],
      ["Delete / Backspace", "Clear selected cells"],
      ["Cmd/Ctrl + Z / Shift+Z", "Undo / Redo"],
      ["Cmd/Ctrl + B / I / U", "Bold / Italic / Underline"],
    ],
  },
  {
    section: "Clipboard",
    rows: [
      ["Cmd/Ctrl + C / X / V", "Copy / Cut / Paste (TSV)"],
    ],
  },
  {
    section: "View",
    rows: [
      ["Cmd/Ctrl + = / − / 0", "Zoom in / out / reset"],
      ["Ctrl + Wheel / Pinch", "Smooth zoom"],
      ["Cmd/Ctrl + F", "Find"],
      ["Cmd/Ctrl + H", "Find & replace"],
      ["?", "This help"],
    ],
  },
];

export function SheetShortcutsModal({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label="Keyboard shortcuts"
        className="max-h-[80vh] w-[640px] overflow-y-auto rounded-overlay bg-popover p-4 shadow-overlay"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-medium">Keyboard shortcuts</h2>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            title="Close"
            onClick={onClose}
            className="size-7"
          >
            <X className="size-4" />
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-4">
          {SHORTCUTS.map((section) => (
            <section key={section.section}>
              <h3 className="mb-2 text-xs leading-3 font-medium text-faint-foreground">
                {section.section}
              </h3>
              <ul className="space-y-1.5">
                {section.rows.map(([keys, desc]) => (
                  <li
                    key={keys}
                    className="flex items-baseline justify-between gap-3 text-sm"
                  >
                    <span className="text-muted-foreground">{desc}</span>
                    <kbd className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs text-faint-foreground">
                      {keys}
                    </kbd>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
