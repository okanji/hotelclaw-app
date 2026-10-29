"use client";

import { AlertTriangle, Plus, Trash2 } from "lucide-react";
import { Chip } from "@/components/ui/chip";
import { Gi } from "@/components/gr8r/icon";
import { Tog } from "@/components/gr8r/settings-ui";
import {
  ACTION_TYPE_META,
  newTicketFieldId,
  type ChatbotAction,
  type ChatbotActionType,
  type ChatbotConfig,
} from "@/lib/chatbots/schema";
import type { ChannelOption, SpaceOption } from "./chatbot-detail";

const ACTION_ORDER: ChatbotActionType[] = [
  "answer_from_knowledge",
  "collect_guest_info",
  "create_ticket",
  "escalate_to_human",
];

/** Default (disabled) action of each type, used when the config has none. */
function defaultAction(type: ChatbotActionType): ChatbotAction {
  switch (type) {
    case "answer_from_knowledge":
      return { type, enabled: false };
    case "collect_guest_info":
      return {
        type,
        enabled: false,
        config: { name: true, email: false, phone: false, room: false },
      };
    case "create_ticket":
      return {
        type,
        enabled: false,
        config: { kind: "request", priority: "medium", fields: [] },
      };
    case "escalate_to_human":
      return {
        type,
        enabled: false,
        config: { notifyRoles: ["owner", "manager"] },
      };
  }
}

/**
 * Actions = what the bot can DO. One card per action type: a toggle, a
 * natural-language "when to use" trigger (injected into the tool
 * description), and type-specific targets (which space tickets land in,
 * which channel gets pinged…). One action of each type max — mirrors the
 * tool registry, which maps each type to a single named tool.
 */
export type KnowledgeSummary = { total: number; trained: number };

export function ActionsPanel({
  config,
  channels,
  spaces,
  knowledge,
  onChange,
}: {
  config: ChatbotConfig;
  channels: ChannelOption[];
  spaces: SpaceOption[];
  knowledge?: KnowledgeSummary;
  onChange: (actions: ChatbotAction[]) => void;
}) {
  function actionOf(type: ChatbotActionType): ChatbotAction {
    return config.actions.find((a) => a.type === type) ?? defaultAction(type);
  }

  function setAction(next: ChatbotAction) {
    const rest = config.actions.filter((a) => a.type !== next.type);
    // Keep stable order so saves don't churn the JSON diff.
    const all = [...rest, next].sort(
      (a, b) => ACTION_ORDER.indexOf(a.type) - ACTION_ORDER.indexOf(b.type),
    );
    onChange(all);
  }

  return (
    <section className="stack" style={{ gap: 10 }}>
      <div>
        <h2 className="sec">Actions</h2>
        <p className="muted" style={{ margin: "4px 0 0", fontSize: 13 }}>
          What the bot can actually do. Each action&apos;s &ldquo;when to
          use&rdquo; tells the bot when to reach for it — write it like
          guidance to a new hire.
        </p>
      </div>
      {ACTION_ORDER.map((type) => (
        <ActionCard
          key={type}
          action={actionOf(type)}
          channels={channels}
          spaces={spaces}
          knowledge={knowledge}
          onChange={setAction}
        />
      ))}
    </section>
  );
}

function ActionCard({
  action,
  channels,
  spaces,
  knowledge,
  onChange,
}: {
  action: ChatbotAction;
  channels: ChannelOption[];
  spaces: SpaceOption[];
  knowledge?: KnowledgeSummary;
  onChange: (next: ChatbotAction) => void;
}) {
  const meta = ACTION_TYPE_META[action.type];

  // Searching knowledge is only useful once something is trained — a bot with
  // this on and an empty/untrained base will call the tool and get nothing.
  const knowledgeWarning =
    action.type === "answer_from_knowledge" && action.enabled && knowledge
      ? knowledge.total === 0
        ? "No knowledge sources yet — add some in the Knowledge tab, or the bot will have nothing to search."
        : knowledge.trained === 0
          ? "Sources added but not trained yet — hit Retrain in the Knowledge tab so the bot can find them."
          : null
      : null;

  return (
    <div
      className="panel"
      style={{
        padding: 14,
        background: action.enabled ? undefined : "var(--g8-surface-2)",
      }}
    >
      <div className="row" style={{ alignItems: "flex-start", gap: 12 }}>
        <div className="grow">
          <div style={{ fontWeight: 600, fontSize: 13.5 }}>{meta.label}</div>
          <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
            {meta.description}
          </div>
        </div>
        <Tog
          label={`${meta.label} enabled`}
          checked={action.enabled}
          onChange={(checked) => onChange({ ...action, enabled: checked })}
        />
      </div>

      {action.enabled ? (
        <div
          className="mt-3 space-y-3 pt-3"
          style={{ borderTop: "1px solid var(--g8-divider)" }}
        >
          {knowledgeWarning ? (
            <div className="alert warn">
              <Gi icon={AlertTriangle} size={14} />
              <span>{knowledgeWarning}</span>
            </div>
          ) : null}
          <div className="space-y-1.5">
            <label className="label">When should the bot use this?</label>
            <textarea
              value={action.whenToUse ?? ""}
              onChange={(e) => onChange({ ...action, whenToUse: e.target.value })}
              rows={2}
              placeholder='e.g. "When the guest has confirmed their order."'
              className="textarea text-sm"
            />
          </div>
          <ActionConfigFields
            action={action}
            channels={channels}
            spaces={spaces}
            onChange={onChange}
          />
        </div>
      ) : null}
    </div>
  );
}

function ActionConfigFields({
  action,
  channels,
  spaces,
  onChange,
}: {
  action: ChatbotAction;
  channels: ChannelOption[];
  spaces: SpaceOption[];
  onChange: (next: ChatbotAction) => void;
}) {
  if (action.type === "answer_from_knowledge") return null;

  if (action.type === "collect_guest_info") {
    const fields = [
      ["name", "Name"],
      ["room", "Room number"],
      ["email", "Email"],
      ["phone", "Phone"],
    ] as const;
    return (
      <div className="flex flex-wrap gap-2">
        {fields.map(([key, label]) => {
          const active = action.config[key];
          return (
            <Chip
              key={key}
              size="sm"
              selected={active}
              onClick={() =>
                onChange({
                  ...action,
                  config: { ...action.config, [key]: !active },
                })
              }
            >
              {label}
            </Chip>
          );
        })}
      </div>
    );
  }

  if (action.type === "create_ticket") {
    const cfg = action.config;
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label className="label">Ticket type</label>
            <select className="select"
              value={cfg.kind}
              onChange={(e) =>
                onChange({
                  ...action,
                  config: { ...cfg, kind: e.target.value as typeof cfg.kind },
                })
              }
            >
              <option value="order">Order (room service, F&B)</option>
              <option value="request">Request (housekeeping, front desk)</option>
              <option value="maintenance">Maintenance issue</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="label">Priority</label>
            <select className="select"
              value={cfg.priority}
              onChange={(e) =>
                onChange({
                  ...action,
                  config: { ...cfg, priority: e.target.value as typeof cfg.priority },
                })
              }
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="label">Tickets land in</label>
            <select className="select"
              value={cfg.spaceId ?? ""}
              onChange={(e) =>
                onChange({
                  ...action,
                  config: { ...cfg, spaceId: e.target.value || undefined },
                })
              }
            >
              <option value="">No team (property inbox)</option>
              {spaces.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="label">Ping channel</label>
            <select className="select"
              value={cfg.notifyChannelId ?? ""}
              onChange={(e) =>
                onChange({
                  ...action,
                  config: { ...cfg, notifyChannelId: e.target.value || undefined },
                })
              }
            >
              <option value="">Don&apos;t post to a channel</option>
              {channels.map((c) => (
                <option key={c.id} value={c.stream_channel_id}>
                  #{c.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="label">Details the bot must collect</label>
          {cfg.fields.map((f, i) => (
            <div key={f.id} className="flex items-center gap-2">
              <input
                value={f.label}
                onChange={(e) => {
                  const fields = [...cfg.fields];
                  fields[i] = { ...f, label: e.target.value };
                  onChange({ ...action, config: { ...cfg, fields } });
                }}
                placeholder="Items ordered"
                className="input h-8 text-sm"
              />
              <Chip
                size="sm"
                selected={!!f.required}
                className="shrink-0"
                onClick={() => {
                  const fields = [...cfg.fields];
                  fields[i] = { ...f, required: !f.required };
                  onChange({ ...action, config: { ...cfg, fields } });
                }}
              >
                required
              </Chip>
              <button className="ibtn ibtn-sm [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5"
                aria-label="Remove field"
                onClick={() =>
                  onChange({
                    ...action,
                    config: { ...cfg, fields: cfg.fields.filter((x) => x.id !== f.id) },
                  })
                }
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
          <button className="btn btn-secondary btn-sm [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5"
            onClick={() =>
              onChange({
                ...action,
                config: {
                  ...cfg,
                  fields: [
                    ...cfg.fields,
                    { id: newTicketFieldId(), label: "", required: false },
                  ],
                },
              })
            }
          >
            <Plus data-slot="icon" />
            Add field
          </button>
        </div>
      </div>
    );
  }

  // escalate_to_human
  const cfg = action.config;
  const roles = [
    ["owner", "Owners"],
    ["manager", "Managers"],
    ["staff", "Staff"],
  ] as const;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div className="space-y-1.5">
        <label className="label">Escalations post to</label>
        <select className="select"
          value={cfg.channelId ?? ""}
          onChange={(e) =>
            onChange({
              ...action,
              config: { ...cfg, channelId: e.target.value || undefined },
            })
          }
        >
          <option value="">Notifications only (no channel)</option>
          {channels.map((c) => (
            <option key={c.id} value={c.stream_channel_id}>
              #{c.name}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1.5">
        <label className="label">Notify</label>
        <div className="flex flex-wrap gap-2 pt-1">
          {roles.map(([role, label]) => {
            const active = cfg.notifyRoles.includes(role);
            return (
              <Chip
                key={role}
                size="sm"
                selected={active}
                onClick={() =>
                  onChange({
                    ...action,
                    config: {
                      ...cfg,
                      notifyRoles: active
                        ? cfg.notifyRoles.filter((r) => r !== role)
                        : [...cfg.notifyRoles, role],
                    },
                  })
                }
              >
                {label}
              </Chip>
            );
          })}
        </div>
      </div>
    </div>
  );
}
