"use client"

import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"

import { cn } from "@/lib/utils"

/**
 * Cover card — the Claude-platform "model card" pattern: a solid pastel
 * cover holding ONE centered glyph (an emoji or a line-art lucide icon),
 * then a quiet body (title + optional meta, description, small tag chips).
 *
 * Use on full-page galleries (workflow templates, bookable services);
 * pickers inside dialogs stay compact text cards (that's the reference
 * pattern too — the platform's template dialog has no covers).
 *
 * Tints are decorative and deliberately NOT theme-switched (the platform
 * keeps the same pastels on dark) — the ink glyph is legible on all six.
 * This map is the single source of cover tints; extend it here, never
 * inline a cover color.
 */
const COVER_TINTS = {
  blue: "bg-[#7fa5e3]",
  coral: "bg-[#dd8a66]",
  cream: "bg-[#efe9de]",
  sage: "bg-[#b9cec5]",
  violet: "bg-[#b5aad4]",
  amber: "bg-[#e3c980]",
} as const

type CoverTint = keyof typeof COVER_TINTS

/** Deterministic tint for collections without a natural color mapping. */
function coverTintAt(index: number): CoverTint {
  const keys = Object.keys(COVER_TINTS) as CoverTint[]
  return keys[index % keys.length]
}

function CoverCard({
  tint = "cream",
  glyph,
  title,
  titleMeta,
  description,
  tags,
  children,
  className,
  render,
  ...props
}: Omit<useRender.ComponentProps<"div">, "title"> & {
  tint?: CoverTint
  /** One glyph on the cover: an emoji string or a lucide icon element. */
  glyph?: React.ReactNode
  title: React.ReactNode
  /** Small element beside the title (e.g. a Badge). */
  titleMeta?: React.ReactNode
  description?: React.ReactNode
  /** Small muted tag chips under the title (e.g. capabilities, surfaces). */
  tags?: string[]
  /** Extra body content (actions row, integration icons…). */
  children?: React.ReactNode
}) {
  const body = (
    <>
      <div
        aria-hidden="true"
        className={cn(
          "flex h-24 shrink-0 items-center justify-center text-[#1f1e1b]",
          "[&_svg]:size-8 [&_svg]:stroke-[1.5]",
          COVER_TINTS[tint]
        )}
      >
        <span className="text-3xl leading-none">{glyph}</span>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2 p-3.5">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">
            {title}
          </span>
          {titleMeta}
        </div>
        {description ? (
          <p className="line-clamp-3 text-xs leading-relaxed text-pretty text-muted-foreground">
            {description}
          </p>
        ) : null}
        {tags?.length ? (
          <div className="flex flex-wrap gap-1">
            {tags.map((t) => (
              <span
                key={t}
                className="rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground"
              >
                {t}
              </span>
            ))}
          </div>
        ) : null}
        {children}
      </div>
    </>
  )

  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(
      {
        className: cn(
          "group/cover-card flex flex-col overflow-hidden rounded-xl border border-border bg-card text-left outline-none",
          // Interactive affordances only when rendered as a link/button.
          "[&:is(a,button)]:cursor-pointer [&:is(a,button)]:transition-colors [&:is(a,button)]:hover:bg-muted/40 [&:is(a,button)]:focus-visible:ring-2 [&:is(a,button)]:focus-visible:ring-ring/50",
          className
        ),
        children: body,
      },
      props
    ),
    render,
    state: { slot: "cover-card" },
  })
}

export { CoverCard, coverTintAt, COVER_TINTS }
