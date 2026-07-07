import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPropertyChannels } from "@/lib/chat/channels";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ propertyId: string }> },
) {
  const { propertyId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    return NextResponse.json(await getPropertyChannels(supabase, propertyId));
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load channels" },
      { status: 500 },
    );
  }
}
