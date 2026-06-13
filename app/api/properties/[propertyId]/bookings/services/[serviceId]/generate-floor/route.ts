import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { generateText, Output } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { getMembershipForProperty } from "@/lib/auth/session";

// POST .../generate-floor — describe the room, get a draft table layout for
// the floor-plan editor (NOT saved; the user adjusts and saves). The model
// only names tables and picks seats/shape/zone — positions are assigned
// deterministically here, zone by zone in rows (the editor exists to drag
// them into shape; research: floor plans are schematics, not architecture).

const GENERATE_MODEL = "claude-haiku-4-5-20251001";

const Body = z.object({ description: z.string().trim().min(1).max(1500) });

const GeneratedFloor = z.object({
  tables: z
    .array(
      z.object({
        name: z.string().min(1).max(12),
        seats: z.number().int().min(1).max(20),
        shape: z.enum(["rect", "round"]),
        zone: z.string().max(30).nullable(),
      }),
    )
    .min(1)
    .max(40),
});

function sizeFor(seats: number): { w: number; h: number } {
  if (seats <= 2) return { w: 8, h: 8 };
  if (seats <= 4) return { w: 11, h: 10 };
  if (seats <= 6) return { w: 14, h: 10 };
  return { w: 17, h: 12 };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ propertyId: string; serviceId: string }> },
) {
  const { propertyId } = await params;
  const membership = await getMembershipForProperty(propertyId);
  if (!membership) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "AI not configured" }, { status: 503 });
  }

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  let generated: z.infer<typeof GeneratedFloor>;
  try {
    const result = await generateText({
      model: anthropic(GENERATE_MODEL),
      output: Output.object({ schema: GeneratedFloor }),
      temperature: 0,
      maxRetries: 2,
      system: [
        "You turn a restaurant-room description into a table list for a floor-plan editor.",
        "Rules:",
        "- One entry per table. Short names: T1, T2… (or P1… for patio, B1… for bar — first letter of the zone).",
        "- seats = the table's MAX covers. 'round' for round tables, else 'rect'.",
        "- zone = the named area when the description has areas (Patio, Bar, Window); null otherwise.",
        "- Respect explicit counts exactly ('eight 2-tops' = 8 entries with seats 2). At most 40 tables.",
      ].join("\n"),
      prompt: body.description,
    });
    generated = result.output;
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "generation failed" },
      { status: 500 },
    );
  }

  // Deterministic layout: zones become bands, tables flow in rows of 5.
  const zones = [...new Set(generated.tables.map((t) => t.zone ?? ""))];
  let y = 6;
  const tables = zones.flatMap((zone) => {
    const inZone = generated.tables.filter((t) => (t.zone ?? "") === zone);
    const rows = Math.ceil(inZone.length / 5);
    const placed = inZone.map((t, i) => {
      const size = sizeFor(t.seats);
      return {
        name: t.name,
        seats: t.seats,
        min_party: Math.max(1, t.seats - 3),
        shape: t.shape,
        x: 5 + (i % 5) * 19,
        y: y + Math.floor(i / 5) * 17,
        ...size,
        zone: t.zone,
        active: true,
      };
    });
    y += rows * 17 + 6;
    return placed;
  });

  return NextResponse.json({ tables });
}
