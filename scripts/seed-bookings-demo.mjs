/**
 * Bookings demo seeder — a full, realistic dataset that shows every surface:
 *
 *   • The Terrace Restaurant (TABLE mode) — 14-table floor plan in three
 *     zones, lunch + dinner service, bookings across yesterday→+3 days with
 *     the whole status lifecycle (pending/confirmed/seated/completed/
 *     cancelled/no_show), best-fit table assignments, chatbot + staff mix.
 *   • Serenity Spa 60-min Massage (capacity 2) — concurrent appointments.
 *   • Sunset Kayak Tour (capacity 12 seats, party-counted) — fixed
 *     departures with seat consumption.
 *   • Full Moon Beach Party (event, one-off date) — customized Night
 *     ticket page, web/chatbot/staff ticket mix.
 *   • Vineyard Sunset Tasting (event, THREE dates) — tonight mid-check-in
 *     ("Almost gone"), +3d exactly sold out, +10d on sale; Gold ticket page.
 *   • Coastal Car Rental (rental units) — incl. a hire out right now.
 *
 * Where to look after seeding: Bookings rail → service items (each kind
 * gets its own workspace: reservations / ticketing door list / rentals);
 * the public pages /book/<slug> and /book/<slug>/event/<id>; Calendar
 * (violet blocks, "Bookings" source toggle); Home → "Today's bookings".
 *
 * Re-runnable: deletes the demo services first (bookings + tables cascade).
 *
 * Run: node --env-file=.env.local --no-network-family-autoselection scripts/seed-bookings-demo.mjs
 */
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const TZ =
  process.env.SEED_TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";

// SEED_PROPERTY_ID pins the target property; otherwise first row wins.
const { data: property } = await (process.env.SEED_PROPERTY_ID
  ? supabase
      .from("properties")
      .select("id, name")
      .eq("id", process.env.SEED_PROPERTY_ID)
      .single()
  : supabase.from("properties").select("id, name").limit(1).single());
if (!property) {
  console.error("No property found — run the main demo seeder first.");
  process.exit(1);
}
console.log(`Seeding bookings demo into ${property.name} (tz ${TZ})\n`);

const DEMO_NAMES = [
  "The Terrace Restaurant",
  "Serenity Spa — 60-min Massage",
  "Sunset Kayak Tour",
  "Full Moon Beach Party",
  "Coastal Car Rental",
  "Vineyard Sunset Tasting",
];
await supabase
  .from("bookable_services")
  .delete()
  .eq("property_id", property.id)
  .in("name", DEMO_NAMES);

// ── helpers ────────────────────────────────────────────────────────────────
/** UTC ISO for wall time HH:MM in TZ on (today + dayOffset). */
function at(dayOffset, time) {
  const base = new Date(Date.now() + dayOffset * 86_400_000);
  const dateStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(base);
  // Two-pass wall→UTC (mirrors lib/bookings/availability.ts).
  let guess = new Date(`${dateStr}T${time}:00Z`);
  for (let i = 0; i < 2; i++) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: TZ,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(guess);
    const get = (t) => parts.find((p) => p.type === t)?.value ?? "00";
    const wall = `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
    const diff = new Date(`${dateStr}T${time}:00Z`) - new Date(`${wall}:00Z`);
    if (diff === 0) break;
    guess = new Date(guess.getTime() + diff);
  }
  return guess.toISOString();
}
let refCounter = 0;
// Property-scoped prefix — `bookings.reference` is globally unique, so two
// properties seeded with the same plain BKG-DEMO* refs silently collide.
const refPrefix = `BKG-D${property.id.slice(0, 4).toUpperCase()}`;
const ref = () => `${refPrefix}-${String(++refCounter).padStart(2, "0")}`;
/** Insert that actually reports failures instead of seeding silence. */
async function mustInsert(table, rows) {
  const { error } = await supabase.from(table).insert(rows);
  if (error) {
    console.error(`✗ ${table} insert failed: ${error.message}`);
    process.exit(1);
  }
}
const allWeek = (ranges) =>
  Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, ranges]));
/** "YYYY-MM-DD" in TZ for (today + dayOffset) — event schedule.dates keys. */
const dayKey = (dayOffset) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(Date.now() + dayOffset * 86_400_000));

// ── 1. The Terrace Restaurant (tables) ────────────────────────────────────
const { data: restaurant } = await supabase
  .from("bookable_services")
  .insert({
    property_id: property.id,
    name: "The Terrace Restaurant",
    kind: "table",
    booking_mode: "tables",
    public_bookable: true,
    emoji: "🍽️",
    description:
      "Mediterranean dining with a sea-view terrace. Lunch 12:00–14:30, dinner 17:30–21:30 (last seating).",
    timezone: TZ,
    schedule: {
      version: 1,
      slotIntervalMinutes: 30,
      durationMinutes: 90,
      capacityPerSlot: 40,
      countPartySize: true,
      maxPartySize: 8,
      minNoticeMinutes: 30,
      horizonDays: 60,
      weekly: allWeek([
        { start: "12:00", end: "14:30" },
        { start: "17:30", end: "21:30" },
      ]),
    },
  })
  .select("id")
  .single();

// Floor plan: window deuces along the top, 4-top field in the middle,
// two round 6-tops at the back, patio zone on the right.
const tables = [
  ...[0, 1, 2, 3].map((i) => ({
    name: `W${i + 1}`, seats: 2, min_party: 1, shape: "round",
    x: 5 + i * 14, y: 6, w: 8, h: 8, zone: "Window",
  })),
  ...[0, 1, 2, 3, 4, 5].map((i) => ({
    name: `M${i + 1}`, seats: 4, min_party: 2, shape: "rect",
    x: 5 + (i % 3) * 19, y: 26 + Math.floor(i / 3) * 20, w: 12, h: 11, zone: "Main",
  })),
  ...[0, 1].map((i) => ({
    name: `B${i + 1}`, seats: 6, min_party: 4, shape: "round",
    x: 8 + i * 26, y: 72, w: 15, h: 14, zone: "Back",
  })),
  ...[0, 1].map((i) => ({
    name: `P${i + 1}`, seats: 4, min_party: 2, shape: "rect",
    x: 70, y: 30 + i * 24, w: 12, h: 11, zone: "Patio",
  })),
];
const { data: tableRows } = await supabase
  .from("service_resources")
  .insert(
    tables.map((t) => ({ ...t, service_id: restaurant.id, property_id: property.id })),
  )
  .select("id, name, seats");
const tableByName = new Map(tableRows.map((t) => [t.name, t.id]));
console.log(`✅ The Terrace Restaurant — ${tableRows.length} tables in 4 zones`);

// Bookings: greedy table picks that match best-fit (deuces→W, fours→M/P, six→B).
const R = (day, time, guest, party, status, table, opts = {}) => ({
  property_id: property.id,
  service_id: restaurant.id,
  reference: ref(),
  guest_name: guest,
  guest_phone: opts.phone ?? null,
  party_size: party,
  starts_at: at(day, time),
  ends_at: new Date(new Date(at(day, time)).getTime() + 90 * 60_000).toISOString(),
  status,
  notes: opts.notes ?? null,
  source: opts.source ?? "staff",
  resource_id: table ? tableByName.get(table) : null,
});

const restaurantBookings = [
  // Yesterday — finished service incl. a no-show and a cancellation.
  R(-1, "12:30", "Lena Hoffmann", 2, "completed", "W1"),
  R(-1, "19:00", "Marco Ricci", 4, "completed", "M2"),
  R(-1, "19:30", "Dana Whitfield", 2, "no_show", "W3"),
  R(-1, "20:00", "Bram Janssen", 6, "cancelled", null),
  // Today — lunch done, dinner in full swing.
  R(0, "12:00", "Yuki Tanaka", 2, "completed", "W2"),
  R(0, "13:00", "Olivia Stone", 4, "completed", "M1"),
  R(0, "17:30", "Pierre Dubois", 2, "seated", "W1", { notes: "Anniversary — sparkling wine on arrival", phone: "+33 6 12 34 56 78" }),
  R(0, "18:00", "Aisha Khan", 4, "seated", "M3", { source: "chatbot", phone: "+44 7700 900123" }),
  R(0, "18:30", "Tom Becker", 6, "confirmed", "B1", { notes: "Birthday table" }),
  R(0, "19:00", "Sofia Marin", 2, "confirmed", "W3", { source: "chatbot" }),
  R(0, "19:30", "James O'Neill", 4, "confirmed", "P1", { notes: "Patio if weather holds" }),
  R(0, "20:00", "Chen Wei", 5, "pending", "B2", { source: "chatbot", phone: "+86 138 0013 8000", notes: "Vegetarian options needed" }),
  R(0, "20:30", "Nora Lindqvist", 2, "pending", null, { source: "chatbot" }),
  // Tomorrow + later.
  R(1, "12:30", "Hugo Schmid", 3, "confirmed", "M4"),
  R(1, "19:00", "Isabella Rossi", 4, "confirmed", "M5", { source: "chatbot" }),
  R(1, "19:30", "Ahmed Farouk", 8, "pending", null, { source: "chatbot", notes: "Asks about a large round table" }),
  R(2, "18:00", "Grace Mwangi", 2, "confirmed", "W4"),
  R(3, "20:00", "Daniel Cohen", 6, "confirmed", "B1"),
  // A walk-in the host seated from the floor plan + a web booking.
  R(0, "19:15", "Walk-in", 2, "seated", "M6"),
  R(1, "20:00", "Charlotte Evans", 4, "pending", null, { source: "web", phone: "+44 7911 123456" }),
];
await mustInsert("bookings", restaurantBookings);
console.log(`   ${restaurantBookings.length} restaurant bookings (yesterday → +3d)`);

// ── 2. Serenity Spa (capacity 2) ───────────────────────────────────────────
const { data: spa } = await supabase
  .from("bookable_services")
  .insert({
    property_id: property.id,
    name: "Serenity Spa — 60-min Massage",
    kind: "appointment",
    booking_mode: "capacity",
    public_bookable: true,
    emoji: "💆",
    description: "Full-body massage, two treatment rooms. Daily 10:00–18:00.",
    timezone: TZ,
    schedule: {
      version: 1,
      slotIntervalMinutes: 60,
      durationMinutes: 60,
      capacityPerSlot: 2,
      countPartySize: false,
      maxPartySize: 2,
      minNoticeMinutes: 120,
      horizonDays: 30,
      weekly: allWeek([{ start: "10:00", end: "18:00" }]),
    },
  })
  .select("id")
  .single();
const S = (day, time, guest, status, opts = {}) => ({
  property_id: property.id,
  service_id: spa.id,
  reference: ref(),
  guest_name: guest,
  party_size: 1,
  starts_at: at(day, time),
  ends_at: new Date(new Date(at(day, time)).getTime() + 60 * 60_000).toISOString(),
  status,
  notes: opts.notes ?? null,
  source: opts.source ?? "staff",
  guest_phone: opts.phone ?? null,
});
const spaBookings = [
  S(0, "11:00", "Pierre Dubois", "completed"),
  S(0, "14:00", "Olivia Stone", "confirmed", { source: "chatbot" }),
  S(0, "14:00", "Mia Sørensen", "confirmed", { notes: "Deep tissue" }),
  S(0, "16:00", "Tom Becker", "pending", { source: "chatbot" }),
  S(1, "10:00", "Aisha Khan", "confirmed", { source: "chatbot" }),
  S(1, "15:00", "Lena Hoffmann", "confirmed"),
  S(2, "12:00", "Chen Wei", "pending", { source: "chatbot" }),
];
await mustInsert("bookings", spaBookings);
console.log(`✅ Serenity Spa — ${spaBookings.length} appointments (2 rooms, incl. a full 14:00 slot)`);

// ── 3. Sunset Kayak Tour (capacity 12, seats counted) ─────────────────────
const { data: tour } = await supabase
  .from("bookable_services")
  .insert({
    property_id: property.id,
    name: "Sunset Kayak Tour",
    kind: "tour",
    booking_mode: "capacity",
    public_bookable: true,
    emoji: "🛶",
    description:
      "Guided 3-hour coastal kayak tour, 12 seats per departure. Gear and snacks included.",
    timezone: TZ,
    schedule: {
      version: 1,
      slotIntervalMinutes: 180,
      durationMinutes: 180,
      capacityPerSlot: 12,
      countPartySize: true,
      maxPartySize: 12,
      minNoticeMinutes: 720,
      horizonDays: 90,
      weekly: allWeek([{ start: "10:00", end: "16:00" }]),
    },
  })
  .select("id")
  .single();
const T = (day, time, guest, party, status, opts = {}) => ({
  property_id: property.id,
  service_id: tour.id,
  reference: ref(),
  guest_name: guest,
  party_size: party,
  starts_at: at(day, time),
  ends_at: new Date(new Date(at(day, time)).getTime() + 180 * 60_000).toISOString(),
  status,
  notes: opts.notes ?? null,
  source: opts.source ?? "chatbot",
});
const tourBookings = [
  T(1, "10:00", "The Janssen family", 4, "confirmed", { notes: "Two kids, ages 9 and 12" }),
  T(1, "10:00", "Sofia Marin", 2, "confirmed"),
  T(1, "10:00", "Daniel Cohen", 3, "pending", { notes: "Asked about waves/safety" }),
  T(2, "13:00", "Grace Mwangi", 2, "confirmed"),
  T(3, "10:00", "Hugo Schmid", 6, "confirmed", { source: "staff" }),
];
await mustInsert("bookings", tourBookings);
console.log(`✅ Sunset Kayak Tour — ${tourBookings.length} departures bookings (tomorrow 10:00 has 9/12 seats taken)`);

// ── 4. Full Moon Beach Party (event — GA tickets, one-off date,
//        customized Luma-style ticket page) ─────────────────────────────────
const partyDate = dayKey(5);
const { data: party } = await supabase
  .from("bookable_services")
  .insert({
    property_id: property.id,
    name: "Full Moon Beach Party",
    kind: "event",
    booking_mode: "capacity",
    public_bookable: true,
    emoji: "🎉",
    description:
      "Beach party with live DJ, fire show, and a welcome cocktail. Doors 21:00.",
    timezone: TZ,
    schedule: {
      version: 1,
      slotIntervalMinutes: 240,
      durationMinutes: 240,
      capacityPerSlot: 120,
      countPartySize: true,
      maxPartySize: 10,
      minNoticeMinutes: 60,
      horizonDays: 180,
      weekly: {},
      dates: { [partyDate]: [{ start: "21:00", end: "21:30" }] },
      priceLabel: "$25 per ticket — reserve now, pay at the door",
      // The customized ticket page (/book/<slug>/event/<id>).
      page: {
        coverStyle: "night",
        coverEmoji: "🌕",
        accent: "#9d174d",
        tagline: "Bonfires, drums, and a midnight swim under the full moon.",
        location: "The beach deck",
        host: "",
        about:
          "Join us on the sand for our monthly full-moon party.\n\nLive drummers from 8pm, the bonfire is lit at 9, and the kitchen serves grilled seafood all night. Bring a towel for the midnight swim — the bar stays open until the last dancer leaves.",
      },
    },
  })
  .select("id")
  .single();
const P = (guest, tickets, status, opts = {}) => ({
  property_id: property.id,
  service_id: party.id,
  reference: ref(),
  guest_name: guest,
  party_size: tickets,
  starts_at: at(5, "21:00"),
  ends_at: new Date(new Date(at(5, "21:00")).getTime() + 240 * 60_000).toISOString(),
  status,
  source: opts.source ?? "chatbot",
  notes: opts.notes ?? null,
});
const partyBookings = [
  P("Aisha Khan", 4, "confirmed"),
  P("Marco Ricci", 2, "confirmed"),
  P("Nora Lindqvist", 6, "confirmed", { notes: "Hen party 🎀" }),
  P("Yuki Tanaka", 2, "pending"),
  P("James O'Neill", 3, "confirmed", { source: "staff" }),
  P("Emma Laurent", 2, "confirmed", { source: "web" }),
  P("Lucas Meyer", 5, "pending", { source: "web" }),
  P("Priya Sharma", 1, "cancelled", { source: "web" }),
];
await mustInsert("bookings", partyBookings);
console.log(
  `✅ Full Moon Beach Party — ${partyBookings
    .filter((b) => b.status !== "cancelled")
    .reduce((s, b) => s + b.party_size, 0)}/120 tickets for ${partyDate} (custom Night ticket page)`,
);

// ── 5. Coastal Car Rental (rental — named units, chosen duration) ──────────
const { data: rental } = await supabase
  .from("bookable_services")
  .insert({
    property_id: property.id,
    name: "Coastal Car Rental",
    kind: "rental",
    booking_mode: "rental",
    public_bookable: true,
    emoji: "🚗",
    description: "Compact cars and an 8-seat van. Pickup at the lobby.",
    timezone: TZ,
    schedule: {
      version: 1,
      slotIntervalMinutes: 60,
      durationMinutes: 240,
      capacityPerSlot: 1,
      countPartySize: false,
      maxPartySize: 8,
      minNoticeMinutes: 120,
      horizonDays: 90,
      rentalDurations: [240, 480, 1440],
      turnaroundMinutes: 60,
      weekly: allWeek([{ start: "08:00", end: "18:00" }]),
      priceLabel: "€60 half-day, €95 full-day, €120 per 24h",
    },
  })
  .select("id")
  .single();
const { data: cars } = await supabase
  .from("service_resources")
  .insert(
    [
      { name: "Car 1", seats: 5, x: 8, y: 12 },
      { name: "Car 2", seats: 5, x: 30, y: 12 },
      { name: "Van 1", seats: 8, x: 52, y: 12, w: 14 },
    ].map((c) => ({
      shape: "rect", min_party: 1, w: 11, h: 12, zone: "Fleet", active: true,
      ...c, service_id: rental.id, property_id: property.id,
    })),
  )
  .select("id, name");
const carByName = new Map(cars.map((c) => [c.name, c.id]));
const C = (day, time, hours, guest, party, status, car, opts = {}) => ({
  property_id: property.id,
  service_id: rental.id,
  reference: ref(),
  guest_name: guest,
  party_size: party,
  starts_at: at(day, time),
  ends_at: new Date(new Date(at(day, time)).getTime() + hours * 3_600_000).toISOString(),
  status,
  source: opts.source ?? "chatbot",
  notes: opts.notes ?? null,
  resource_id: car ? carByName.get(car) : null,
});
const rentalBookings = [
  C(0, "09:00", 8, "Bram Janssen", 2, "seated", "Car 1", { notes: "Out for the day" }),
  C(0, "10:00", 4, "Grace Mwangi", 4, "completed", "Car 2", { source: "staff" }),
  C(1, "08:00", 24, "The Janssen family", 6, "confirmed", "Van 1"),
  C(1, "09:00", 8, "Pierre Dubois", 2, "pending"),
  C(2, "10:00", 4, "Isabella Rossi", 3, "confirmed", "Car 1"),
];
await mustInsert("bookings", rentalBookings);
console.log(`✅ Coastal Car Rental — 3 units, ${rentalBookings.length} hires (incl. a 24h van rental + 60-min turnaround)`);

// ── 6. Vineyard Sunset Tasting (event — MULTI-date: tonight with door
//        check-ins, +3d sold out, +10d on sale) ────────────────────────────
const tastingDates = { today: dayKey(0), soldOut: dayKey(3), onSale: dayKey(10) };
const { data: tasting } = await supabase
  .from("bookable_services")
  .insert({
    property_id: property.id,
    name: "Vineyard Sunset Tasting",
    kind: "event",
    booking_mode: "capacity",
    public_bookable: true,
    emoji: "🍷",
    description:
      "Five local wines, one golden hour. Guided tasting on the west lawn with our sommelier.",
    timezone: TZ,
    schedule: {
      version: 1,
      slotIntervalMinutes: 120,
      durationMinutes: 120,
      capacityPerSlot: 24,
      countPartySize: true,
      maxPartySize: 6,
      minNoticeMinutes: 60,
      horizonDays: 180,
      weekly: {},
      dates: Object.fromEntries(
        Object.values(tastingDates).map((d) => [d, [{ start: "18:00", end: "18:30" }]]),
      ),
      priceLabel: "€45 per person — pay at the venue",
      page: {
        coverStyle: "gold",
        coverEmoji: "🍷",
        accent: "#b45309",
        tagline: "Five local wines, one golden hour.",
        location: "The west lawn",
        host: "",
        about:
          "Our sommelier walks you through five wines from vineyards within an hour of the property — what to smell, what to taste, and the stories behind each bottle.\n\nEach tasting is paired with local cheese and olive bread. The session ends as the sun touches the water, glass in hand.\n\nSeats are limited to 24 per evening so everyone can ask questions.",
      },
    },
  })
  .select("id")
  .single();
const V = (day, guest, tickets, status, opts = {}) => ({
  property_id: property.id,
  service_id: tasting.id,
  reference: ref(),
  guest_name: guest,
  party_size: tickets,
  starts_at: at(day, "18:00"),
  ends_at: new Date(new Date(at(day, "18:00")).getTime() + 120 * 60_000).toISOString(),
  status,
  source: opts.source ?? "web",
  notes: opts.notes ?? null,
});
const tastingBookings = [
  // Tonight — 20/24 sold ("Almost gone"), door list mid-check-in.
  V(0, "Amelia Carter", 4, "seated"),
  V(0, "Henrik Olsen", 2, "seated", { source: "chatbot" }),
  V(0, "Rosa Delgado", 2, "seated", { notes: "Asked for a no-alcohol pairing for one guest" }),
  V(0, "Felix Wagner", 4, "confirmed"),
  V(0, "Ines Costa", 2, "confirmed", { source: "chatbot" }),
  V(0, "Noah Brand", 4, "confirmed", { source: "staff" }),
  V(0, "Zara Ali", 2, "pending"),
  V(0, "Late Cancel", 2, "cancelled"),
  // +3 days — exactly 24/24: the public page shows SOLD OUT.
  V(3, "The Okafor group", 6, "confirmed"),
  V(3, "Mateo Fernández", 4, "confirmed", { source: "chatbot" }),
  V(3, "Hannah Levi", 4, "confirmed"),
  V(3, "Jack Thompson", 4, "confirmed", { source: "staff" }),
  V(3, "Lina Berg", 4, "confirmed"),
  V(3, "Omar Haddad", 2, "pending", { notes: "Asked to be moved to the next date if it frees up" }),
  // +10 days — 6/24, plenty left.
  V(10, "Eva Novak", 4, "confirmed"),
  V(10, "Sam Porter", 2, "pending", { source: "chatbot" }),
];
await mustInsert("bookings", tastingBookings);
const soldFor = (day) =>
  tastingBookings
    .filter((b) => b.starts_at === at(day, "18:00") && b.status !== "cancelled")
    .reduce((s, b) => s + b.party_size, 0);
console.log(
  `✅ Vineyard Sunset Tasting — tonight ${soldFor(0)}/24 (8 checked in), +3d ${soldFor(3)}/24 SOLD OUT, +10d ${soldFor(10)}/24 (custom Gold ticket page)`,
);

const { data: prop } = await supabase
  .from("properties")
  .select("slug")
  .eq("id", property.id)
  .single();
console.log(`
Done. Look at:
  • Bookings sidebar → one item per service; each opens its kind workspace
      🍽️ Terrace — Reservations / Floor plan / Timetable (walk-in seated at M6)
      🎉 Beach Party — ticketing door list, sold meter (custom Night page)
      🍷 Tasting — tonight's door list mid-check-in (8 in), +3d SOLD OUT
      🚗 Car Rental — units timetable, "1 out now"
  • Public pages:
      /book/${prop.slug}
      /book/${prop.slug}/event/${party.id}   (Night 🌕 berry)
      /book/${prop.slug}/event/${tasting.id} (Gold 🍷 amber — try the date chips)
  • Bookings → All bookings / Pending (web + chatbot + staff source mix)
  • Calendar (violet booking blocks; toggle the "Bookings" source)
  • Home → Today's bookings widget`);
