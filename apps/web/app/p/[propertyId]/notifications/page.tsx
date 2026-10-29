import { redirect } from "next/navigation";

/**
 * Notifications folded into the Inbox (2026-10-29) — the Inbox already lists
 * the same rows with an Unread toggle, Mark all as read and per-row read
 * toggles. This route stays so old links and bookmarks keep working:
 * `?filter=unread` becomes the Inbox's Unread view.
 */
export default async function NotificationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ propertyId: string }>;
  searchParams: Promise<{ filter?: string }>;
}) {
  const { propertyId } = await params;
  const { filter } = await searchParams;
  redirect(
    `/p/${propertyId}/activity${filter === "unread" ? "?view=unread" : ""}`,
  );
}
