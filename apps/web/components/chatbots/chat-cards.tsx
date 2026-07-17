import { CalendarCheck2, Clock, Sparkles } from "lucide-react";
import { parseChatAttachments, type ChatCard } from "@/lib/chatbots/cards";

/**
 * Renders the structured cards a guest bot attaches to a reply (service
 * lists, availability slots, booking confirmations). Fixed light palette so
 * it reads identically on the warm public guest page and the dark in-app
 * test console — a legible "data card" on either background, no theme
 * coupling. `onSend` (when provided) turns affordances into a follow-up
 * guest message that drives the bot's booking flow; without it (staff
 * transcript) the cards are read-only.
 */
export function ChatCards({
  attachments,
  accent = "#c96442",
  onSend,
}: {
  attachments: unknown;
  accent?: string;
  onSend?: (text: string) => void;
}) {
  const cards = parseChatAttachments(attachments);
  if (cards.length === 0) return null;
  return (
    <div className="mt-2 flex flex-col gap-2">
      {cards.map((card, i) => (
        <Card key={i} card={card} accent={accent} onSend={onSend} />
      ))}
    </div>
  );
}

function Card({
  card,
  accent,
  onSend,
}: {
  card: ChatCard;
  accent: string;
  onSend?: (text: string) => void;
}) {
  if (card.type === "services") {
    return (
      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
        <ul role="list" className="divide-y divide-zinc-100">
          {card.services.map((s) => (
            <li
              key={s.id}
              className="flex items-start gap-3 px-3 py-2.5"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-zinc-900">
                  {s.name}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-zinc-500">
                  {s.price ? (
                    <span className="font-medium text-zinc-700">{s.price}</span>
                  ) : null}
                  {s.durationMinutes ? (
                    <span className="inline-flex items-center gap-0.5">
                      <Clock className="size-3" />
                      {s.durationMinutes} min
                    </span>
                  ) : null}
                  {s.kind ? <span className="capitalize">{s.kind}</span> : null}
                </div>
                {s.description ? (
                  <p className="mt-1 line-clamp-2 text-xs leading-snug text-zinc-500">
                    {s.description}
                  </p>
                ) : null}
              </div>
              {onSend ? (
                <button
                  type="button"
                  onClick={() => onSend(`I'd like to book the ${s.name}.`)}
                  className="mt-0.5 shrink-0 rounded-lg px-2.5 py-1 text-xs font-medium text-white transition-opacity hover:opacity-90"
                  style={{ backgroundColor: accent }}
                >
                  Book
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (card.type === "slots") {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2.5">
        <div className="mb-2 text-xs font-medium text-zinc-500">
          {card.serviceName}
          {card.date ? ` · ${card.date}` : ""}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {card.slots.map((slot) => {
            const label = slot.label;
            const chip = (
              <span className="inline-flex items-center gap-1">
                {label}
                {typeof slot.spotsLeft === "number" && slot.spotsLeft <= 3 ? (
                  <span className="text-xs text-zinc-400">
                    {slot.spotsLeft} left
                  </span>
                ) : null}
              </span>
            );
            return onSend ? (
              <button
                key={slot.startsAt}
                type="button"
                onClick={() =>
                  onSend(`Book ${card.serviceName} at ${label}.`)
                }
                className="rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs font-medium text-zinc-800 transition-colors hover:border-zinc-300 hover:bg-zinc-100"
              >
                {chip}
              </button>
            ) : (
              <span
                key={slot.startsAt}
                className="rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs font-medium text-zinc-700"
              >
                {chip}
              </span>
            );
          })}
        </div>
      </div>
    );
  }

  // booking_confirmed
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5">
      <CalendarCheck2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
      <div className="min-w-0 text-xs leading-snug text-emerald-900">
        <div className="font-semibold">{card.serviceName} — booked</div>
        <div className="mt-0.5 text-emerald-700">
          {card.when ? `${card.when} · ` : ""}
          {card.partySize ? `party of ${card.partySize} · ` : ""}
          ref <span className="font-mono">{card.reference}</span>
        </div>
      </div>
      <Sparkles className="mt-0.5 size-3.5 shrink-0 text-emerald-400" />
    </div>
  );
}
