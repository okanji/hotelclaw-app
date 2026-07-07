import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const ids = request.nextUrl.searchParams.getAll("ids");
  if (ids.length === 0) return NextResponse.json({});

  // RLS on profiles ensures we only return shared-property users.
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, avatar_url")
    .in("id", ids);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const map: Record<string, { name: string; avatar?: string }> = {};
  for (const p of data ?? []) {
    map[p.id] = {
      name: p.full_name ?? p.id.slice(0, 6),
      avatar: p.avatar_url ?? undefined,
    };
  }
  return NextResponse.json(map);
}
