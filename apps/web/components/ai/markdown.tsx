"use client";

import { memo, type ComponentProps, type ComponentType } from "react";
import {
  Streamdown,
  defaultComponents,
  useIsCodeFenceIncomplete,
  type ExtraProps,
} from "streamdown";
import { cjk } from "@streamdown/cjk";
import { math } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockLine,
  CodeBlockTitle,
} from "@/components/ui/code-block";
import { useHighlightedCode } from "@/hooks/use-highlighted-code";
import { cn } from "@/lib/utils";

/**
 * The reply renderer — the shadcn/ui AI Elements "Message" pattern's
 * markdown: Streamdown (GFM, math, mermaid, CJK, incomplete-markdown repair
 * while tokens stream) with fenced code routed to the Code Block primitive
 * through `components.code`, "so code in the reply gets line numbers and a
 * copy button" (ui.shadcn.com/docs/components/base/code-block#markdown).
 * Streamdown sets `data-block` on fenced code only, so inline code stays
 * inline; a ```mermaid fence goes back to Streamdown's own renderer, which
 * the diagram plugin draws.
 *
 * `app/globals.css` carries the `@source` line for Streamdown's classes —
 * without it streamed markdown is unstyled.
 */

const plugins = { cjk, math, mermaid };

function MarkdownCodeBlock({ code, language }: { code: string; language: string }) {
  // True while the closing fence has not arrived yet.
  const incomplete = useIsCodeFenceIncomplete();
  const lines = useHighlightedCode(code, language);

  return (
    <CodeBlock size="sm" className="my-2">
      <CodeBlockHeader>
        <CodeBlockTitle>{language || "text"}</CodeBlockTitle>
        <CodeBlockActions>
          <CodeBlockCopyButton value={code} disabled={incomplete} />
        </CodeBlockActions>
      </CodeBlockHeader>
      <CodeBlockContent>
        {lines.map((line, index) => (
          <CodeBlockLine key={index}>{line}</CodeBlockLine>
        ))}
      </CodeBlockContent>
    </CodeBlock>
  );
}

type CodeProps = ComponentProps<"code"> & ExtraProps;
const DefaultCode = (defaultComponents as unknown as Record<string, ComponentType<CodeProps> | undefined>)
  .code;

function MarkdownCode({ className, children, ...props }: CodeProps) {
  // Streamdown marks fenced code with data-block. Everything else is inline.
  if (!("data-block" in props)) {
    return (
      <code className="rounded-sm bg-muted px-1 py-0.5 font-mono text-[0.9em]" {...props}>
        {children}
      </code>
    );
  }
  const language = /language-(\S+)/.exec(className ?? "")?.[1] ?? "";
  if (language === "mermaid" && DefaultCode) {
    return (
      <DefaultCode className={className} {...props}>
        {children}
      </DefaultCode>
    );
  }
  return (
    <MarkdownCodeBlock code={typeof children === "string" ? children : ""} language={language} />
  );
}

const components = { code: MarkdownCode };

export type MarkdownProps = {
  children: string;
  /** True while the reply streams — enables fence-aware copy + repair. */
  isAnimating?: boolean;
  className?: string;
};

export const Markdown = memo(
  function Markdown({ children, isAnimating = false, className }: MarkdownProps) {
    return (
      <Streamdown
        controls={false}
        components={components}
        plugins={plugins}
        isAnimating={isAnimating}
        className={cn("size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0", className)}
      >
        {children}
      </Streamdown>
    );
  },
  (prev, next) =>
    prev.children === next.children &&
    prev.isAnimating === next.isAnimating &&
    prev.className === next.className,
);
