/**
 * SOP template BODIES — the server-side half of `templates.ts`. Imported
 * only from `createWorkspace` (and tests); never from client code.
 *
 * Bodies are hand-written HTML in the subset `writeDocumentBody` accepts
 * (h1/h2/h3, p, ul/ol/li, blockquote, strong/em). `{{propertyName}}` is the
 * only placeholder — filled deterministically, never by the model. The AI's
 * contribution is an optional one-line `intro` (escaped, rendered as an
 * opening emphasis paragraph).
 */

const BODIES: Record<string, string> = {
  "emergency-procedures": `
<h1>Emergency &amp; incident procedures</h1>
<p>What to do when something goes wrong at {{propertyName}}. Read this once now — in an emergency you won't have time to.</p>
<h2>Emergency contacts</h2>
<ul>
  <li><strong>Emergency services:</strong> add your local number here</li>
  <li><strong>Duty manager:</strong> add name + phone</li>
  <li><strong>Maintenance on-call:</strong> add name + phone</li>
  <li><strong>Utilities (gas / water / power):</strong> add provider numbers</li>
</ul>
<h2>Fire</h2>
<ol>
  <li>Raise the alarm and call emergency services first — never investigate alone.</li>
  <li>Start the evacuation. Staff guide guests to the assembly point (add location here).</li>
  <li>Close doors behind you where safe. Do not use lifts.</li>
  <li>Duty manager takes the guest list / occupancy report for the roll call.</li>
</ol>
<h2>Medical incident</h2>
<ol>
  <li>Call emergency services for anything beyond minor first aid.</li>
  <li>Send a second person to meet responders at the entrance.</li>
  <li>Stay with the person; do not move them unless they're in danger.</li>
</ol>
<h2>After any incident</h2>
<p>Log it the same day using the incident report form — what happened, where, who was involved, whether authorities attended. If someone was hurt or property was damaged, tell the manager before the shift ends, not in the handover.</p>`,

  "shift-handover": `
<h1>Shift handover playbook</h1>
<p>A shift at {{propertyName}} isn't over until the next one can start without surprises. The handover is how that happens.</p>
<h2>Before you leave, write down</h2>
<ul>
  <li><strong>Open issues:</strong> anything unresolved a guest or manager is waiting on.</li>
  <li><strong>In-progress work:</strong> tasks started but not finished, and where they stand.</li>
  <li><strong>Heads-up items:</strong> arrivals, bookings, deliveries, or maintenance visits due next shift.</li>
  <li><strong>Anything unusual:</strong> complaints, incidents, near-misses, odd requests.</li>
</ul>
<h2>How to hand over</h2>
<ol>
  <li>Post your notes in the handovers channel before you clock out.</li>
  <li>Walk the incoming lead through the open issues in person when you overlap.</li>
  <li>Anything urgent gets a task with an assignee — a note nobody owns is a note nobody actions.</li>
</ol>
<h2>Starting your shift</h2>
<p>Read the last handover before doing anything else. If something is unclear, ask while the previous shift is still reachable.</p>`,

  "guest-complaint": `
<h1>Guest complaint handling SOP</h1>
<p>Complaints are recoverable — a guest whose problem gets fixed well often leaves happier than one who never had a problem. This is how {{propertyName}} handles them.</p>
<h2>In the moment: LEARN</h2>
<ol>
  <li><strong>Listen</strong> — let them finish. Don't interrupt, don't defend.</li>
  <li><strong>Empathize</strong> — "I'd be frustrated too." Mean it.</li>
  <li><strong>Apologize</strong> — once, sincerely, without blaming a colleague or a system.</li>
  <li><strong>React</strong> — fix what you can fix now. Say exactly what will happen and when.</li>
  <li><strong>Notify</strong> — log it so the pattern is visible, even when it's resolved.</li>
</ol>
<h2>Escalate to a manager when</h2>
<ul>
  <li>The guest asks for one, or you've apologized twice and they're still escalating.</li>
  <li>Money is involved beyond a small goodwill gesture.</li>
  <li>There's any mention of injury, safety, or legal action.</li>
</ul>
<h2>Afterwards</h2>
<p>Log every complaint through the guest feedback form the same day. Managers review the log weekly for repeats — one bad pillow is a pillow; three is a purchasing decision.</p>`,

  "new-hire-onboarding": `
<h1>New team member onboarding</h1>
<p>The goal of week one at {{propertyName}}: by Friday the new person knows where things are, who to ask, and what good looks like in their role.</p>
<h2>Before they start</h2>
<ul>
  <li>Invite them to this workspace and add them to their team.</li>
  <li>Prepare uniform / name badge / logins as applicable.</li>
  <li>Assign a buddy — one named person for the silly questions.</li>
</ul>
<h2>Day one</h2>
<ol>
  <li>Property tour: exits, staff areas, storage, where everything lives.</li>
  <li>Introductions to the team they'll work beside.</li>
  <li>Walk through the emergency procedures doc together.</li>
  <li>Shadow, don't solo — pair them with their buddy all shift.</li>
</ol>
<h2>First week</h2>
<ul>
  <li>Read the SOPs for their department; tick each off with their manager.</li>
  <li>Learn the handover routine and post one supervised handover.</li>
  <li>End-of-week check-in with their manager: what's unclear, what do they need?</li>
</ul>`,

  "opening-checklist": `
<h1>Opening checklist</h1>
<p>Run this every morning at {{propertyName}} before the first guest walks in. Tick items in order — the sequence matters.</p>
<h2>First in</h2>
<ul>
  <li>Unlock, disarm, lights on. Note anything out of place from overnight.</li>
  <li>Walk the floor: cleanliness, temperature, anything broken → log a maintenance request now, not later.</li>
  <li>Check the handover notes from close.</li>
</ul>
<h2>Setup</h2>
<ul>
  <li>Equipment on and checked (coffee machine, POS, kitchen equipment as applicable).</li>
  <li>Stock check: what's low for today's expected covers?</li>
  <li>Float counted and signed into the till.</li>
  <li>Tables / front area set to standard.</li>
</ul>
<h2>Before doors open</h2>
<ul>
  <li>Team briefing: today's bookings, specials, 86'd items, who's on what section.</li>
  <li>Music, signage, doors — open.</li>
</ul>`,

  "closing-checklist": `
<h1>Closing checklist</h1>
<p>Closing {{propertyName}} well is what makes tomorrow's opening fast. Nothing on this list is optional.</p>
<h2>Front of house</h2>
<ul>
  <li>Last guests out gracefully; doors locked behind them.</li>
  <li>Tables cleared, wiped, and reset for tomorrow.</li>
  <li>Floors done; bins out.</li>
</ul>
<h2>Back of house</h2>
<ul>
  <li>Equipment cleaned and switched off per its own procedure.</li>
  <li>Food labeled, dated, and stored; temperatures logged.</li>
  <li>Anything broken or running low → log it now so the morning knows.</li>
</ul>
<h2>Cash &amp; security</h2>
<ul>
  <li>Till reconciled and cashed up; float set for tomorrow.</li>
  <li>Post the handover note: takings summary, issues, anything for the opener.</li>
  <li>Final walkthrough — windows, taps, gas, heaters. Alarm set, lights off, lock up.</li>
</ul>`,

  "housekeeping-room": `
<h1>Room cleaning standards</h1>
<p>Every room at {{propertyName}} gets the same sequence — a consistent order is what makes rooms consistently right.</p>
<h2>The sequence</h2>
<ol>
  <li><strong>Air &amp; strip:</strong> knock, enter, curtains and windows open, strip linens and towels.</li>
  <li><strong>Top-down dust:</strong> high surfaces first so dust falls before you clean lower ones.</li>
  <li><strong>Bathroom:</strong> apply cleaner and let it work while you make the bed. Then scrub, rinse, dry, restock.</li>
  <li><strong>Bed:</strong> fresh linens, corners tight, presentation to house standard.</li>
  <li><strong>Surfaces &amp; floor:</strong> wipe touchpoints (handles, switches, remote), restock amenities, vacuum your way out the door.</li>
</ol>
<h2>Final check before you close the door</h2>
<ul>
  <li>Everything works: lights, safe, kettle, TV.</li>
  <li>Nothing left behind — yours or the previous guest's. Lost property gets logged, never pocketed or binned.</li>
  <li>It smells clean and neutral.</li>
</ul>
<h2>Report, don't improvise</h2>
<p>Stains that won't lift, damage, or anything broken: log a maintenance request and flag the room — don't return it to sellable until it's right.</p>`,

  "maintenance-triage": `
<h1>Maintenance request triage SOP</h1>
<p>Every issue at {{propertyName}} gets logged through the maintenance form — that's what makes the workload visible and nothing forgotten. This SOP is about what happens next.</p>
<h2>Urgency levels</h2>
<ul>
  <li><strong>Urgent — today:</strong> safety hazards, water where it shouldn't be, no heating/cooling in occupied areas, anything guest-blocking. Drop-everything; call, don't just log.</li>
  <li><strong>Normal — this week:</strong> broken but workaround-able. Scheduled into the week's work.</li>
  <li><strong>Low — whenever:</strong> cosmetic wear. Batched into quiet periods.</li>
</ul>
<h2>The flow</h2>
<ol>
  <li>Anyone spots an issue → submits the maintenance form (a task is created automatically).</li>
  <li>The maintenance lead triages new tasks each morning: confirm the urgency, assign an owner.</li>
  <li>The assignee updates the task as it moves — blocked tasks say <em>why</em> (parts, contractor, access).</li>
  <li>Done means verified fixed, not "should be fine now".</li>
</ol>
<h2>Escalate when</h2>
<p>A repair needs an outside contractor, costs above your approval level, or the same fault returns a third time — that's a replacement conversation, not another repair.</p>`,
};

/** HTML-escape AI-provided intro text before it enters the doc body. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Render a template body for a property: fill `{{propertyName}}` and inject
 *  the optional AI intro line right under the H1. Returns null for unknown
 *  ids (callers fall back to a titled stub). */
export function renderSopTemplate(args: {
  templateId: string;
  propertyName: string;
  intro?: string;
}): string | null {
  const raw = BODIES[args.templateId];
  if (!raw) return null;
  let html = raw.trim().replace(/\{\{propertyName\}\}/g, escapeHtml(args.propertyName));
  const intro = args.intro?.trim();
  if (intro) {
    html = html.replace(/<\/h1>/, `</h1>\n<p><em>${escapeHtml(intro)}</em></p>`);
  }
  return html;
}

export function hasSopBody(templateId: string): boolean {
  return templateId in BODIES;
}
