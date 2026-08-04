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
 * Tints now come from the shared warm low-chroma `--tint-*` family (the same
 * palette `TintCard` spends), so covers are theme-adaptive and carry their
 * own matching ink — no hardcoded hex, no separate pastel ramp to keep in
 * sync. This map is the single source of cover tints; extend it here, never
 * inline a cover color. The KEYS are stored in call-site maps — never rename
 * them, only re-point them.
 */
const COVER_TINTS = {
  blue: "bg-tint-blue text-tint-blue-ink",
  coral: "bg-tint-coral text-tint-coral-ink",
  cream: "bg-secondary text-cover-ink",
  sage: "bg-tint-sage text-tint-sage-ink",
  violet: "bg-tint-lavender text-tint-lavender-ink",
  amber: "bg-tint-honey text-tint-honey-ink",
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
          "flex h-24 shrink-0 items-center justify-center",
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
          <p className="line-clamp-3 text-sm text-pretty text-muted-foreground">
            {description}
          </p>
        ) : null}
        {tags?.length ? (
          <div className="flex flex-wrap gap-1">
            {tags.map((t) => (
              <span
                key={t}
                className="rounded-md bg-accent px-1.5 py-0.5 text-xs font-medium text-faint-foreground"
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
          "group/cover-card flex flex-col overflow-hidden rounded-md bg-card text-left shadow-ring outline-none",
          // Interactive affordances only when rendered as a link/button.
          // Fill-only hover (opaque surface ⇒ `bg-secondary`, not the
          // translucent `bg-accent`), no border shift, no shadow, no lift.
          "[&:is(a,button)]:cursor-pointer [&:is(a,button)]:transition-colors [&:is(a,button)]:hover:bg-accent [&:is(a,button)]:focus-visible:shadow-focus",
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
