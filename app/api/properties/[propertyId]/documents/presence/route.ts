import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import {
  getLiveblocksServer,
  roomIdForDocument,
} from "@/lib/liveblocks/server";
import { uniquePresenceUsers } from "@/lib/documents/presence";

const PropertyId = z.string().uuid();
const DocumentIds = z
  .string()
  .transform((s) => s.split(",").map((id) => id.trim()).filter(Boolean))
  .pipe(z.array(z.string().uuid()).max(15));

/**
 * Batch presence for document rooms — used by the docs home to show who is
 * currently viewing/editing each doc without opening N Liveblocks connections.
 * Liveblocks recommends polling at most every 10s.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ propertyId: string }> },
) {
  const { propertyId } = await params;
  const p = PropertyId.safeParse(propertyId);
  if (!p.success) {
    return NextResponse.json({ error: "Invalid property id" }, { status: 400 });
  }

  const idsParam = new URL(request.url).searchParams.get("ids") ?? "";
  const parsedIds = DocumentIds.safeParse(idsParam);
  if (!parsedIds.success) {
    return NextResponse.json({ error: "Invalid document ids" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { data: membership } = await supabase
    .from("memberships")
    .select("property_id")
    .eq("property_id", p.data)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const lb = getLiveblocksServer();
  const entries = await Promise.all(
    parsedIds.data.map(async (documentId) => {
      const roomId = roomIdForDocument(p.data, documentId);
      try {
        const { data } = await lb.getActiveUsers(roomId);
        return {
          documentId,
          users: uniquePresenceUsers(
            data
              .filter((u): u is typeof u & { id: string } => u.id != null)
              .map((u) => ({
                id: u.id,
                name: (u.info as { name?: string } | undefined)?.name ?? "Someone",
                avatar: (u.info as { avatar?: string } | undefined)?.avatar,
              })),
          ),
        };
      } catch {
        return { documentId, users: [] };
      }
    }),
  );

  return NextResponse.json(entries);
}
