import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const origin = url.origin;
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next");

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      const target = new URL("/login", origin);
      target.searchParams.set("error", error.message);
      return NextResponse.redirect(target);
    }
  }

  if (next) {
    return NextResponse.redirect(new URL(next, origin));
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(new URL("/login", origin));
  }

  const { data: memberships } = await supabase
    .from("memberships")
    .select("property_id")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1);

  if (!memberships || memberships.length === 0) {
    return NextResponse.redirect(new URL("/onboarding", origin));
  }

  return NextResponse.redirect(
    new URL(`/p/${memberships[0].property_id}/chat`, origin),
  );
}
