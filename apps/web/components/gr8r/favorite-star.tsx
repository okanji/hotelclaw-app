"use client";

import { Star } from "lucide-react";
import { useFavorites } from "@/lib/favorites/use-favorites";
import type { FavoriteKind } from "@/lib/db/types";
import { Gi } from "./icon";

/**
 * gr8r's favorite toggle (`toggleFavProj` in src/pages/project.js): an
 * `.ibtn` star that turns amber when on. One component for every kind this
 * app can star — project, team, doc, form, channel. Tasks keep their own
 * star (`task_favorites`, task detail).
 */
export function FavoriteStar({
  propertyId,
  kind,
  id,
  label,
  size = 15,
  className = "ibtn ibtn-sm",
}: {
  propertyId: string;
  kind: FavoriteKind;
  id: string;
  /** The entity's name, for the "Added X to favorites" toast. */
  label?: string;
  size?: number;
  className?: string;
}) {
  const { isFavorite, toggle } = useFavorites(propertyId);
  const on = isFavorite(kind, id);
  return (
    <button
      type="button"
      className={className}
      aria-pressed={on}
      aria-label={on ? "Remove from favorites" : "Add to favorites"}
      style={on ? { color: "var(--g8-amber)" } : undefined}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void toggle(kind, id, label);
      }}
    >
      <Gi icon={Star} size={size} />
    </button>
  );
}

/** The small amber star gr8r prints after a starred name (cards, sidebar). */
export function FavMark({ size = 12 }: { size?: number }) {
  return (
    <span className="fav" style={{ color: "var(--g8-amber)", display: "inline-flex" }} aria-label="Favorite">
      <Gi icon={Star} size={size} />
    </span>
  );
}
