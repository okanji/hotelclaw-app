"use client";

import { AlertTriangle, Plus, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  ACTION_TYPE_META,
  newTicketFieldId,
  type ChatbotAction,
  type ChatbotActionType,
  type ChatbotConfig,
} from "@/lib/chatbots/schema";
import type { ChannelOption, SpaceOption } from "./chatbot-detail";
import { NativeSelect } from "@/components/ui/native-select";

const ACTION_ORDER: ChatbotActionType[] = [
  "answer_from_knowledge",
  "collect_guest_info",
  "create_ticket",
  "book_service",
  "escalate_to_human",
];

export type BookableServiceOption = {
  id: string;
  name: string;
  emoji: string | null;
  active: boolean;
};

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
    case "book_service":
      return {
        type,
        enabled: false,
        config: { serviceIds: [], autoConfirm: true },
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
  services = [],
  knowledge,
  onChange,
}: {
  config: ChatbotConfig;
  channels: ChannelOption[];
  spaces: SpaceOption[];
  services?: BookableServiceOption[];
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
    <section className="space-y-3">
      <div>
        <p className="text-sm font-medium">Actions</p>
        <p className="text-xs text-muted-foreground">
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
          services={services}
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
  services,
  knowledge,
  onChange,
}: {
  action: ChatbotAction;
  channels: ChannelOption[];
  spaces: SpaceOption[];
  services: BookableServiceOption[];
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
      className={cn(
        "rounded-md p-4 transition-colors",
        action.enabled ? "bg-background" : "bg-muted",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium">{meta.label}</p>
          <p className="text-xs text-muted-foreground">{meta.description}</p>
        </div>
        <Switch
          checked={action.enabled}
          aria-label={`${meta.label} enabled`}
          onCheckedChange={(checked) => onChange({ ...action, enabled: checked })}
        />
      </div>

      {action.enabled ? (
        <div className="mt-3 space-y-3 border-t border-border pt-3">
          {knowledgeWarning ? (
            <div className="flex items-start gap-2 rounded-md bg-warning/10 px-3 py-2 text-xs text-warning">
              <AlertTriangle className="mt-px size-3.5 shrink-0" />
              <span>{knowledgeWarning}</span>
            </div>
          ) : null}
          <div className="space-y-1.5">
            <Label className="text-xs">When should the bot use this?</Label>
            <Textarea
              value={action.whenToUse ?? ""}
              onChange={(e) => onChange({ ...action, whenToUse: e.target.value })}
              rows={2}
              placeholder='e.g. "When the guest has confirmed their order."'
              className="text-sm"
            />
          </div>
          <ActionConfigFields
            action={action}
            channels={channels}
            spaces={spaces}
            services={services}
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
  services,
  onChange,
}: {
  action: ChatbotAction;
  channels: ChannelOption[];
  spaces: SpaceOption[];
  services: BookableServiceOption[];
  onChange: (next: ChatbotAction) => void;
}) {
  if (action.type === "answer_from_knowledge") return null;

  if (action.type === "book_service") {
    const cfg = action.config;
    const activeServices = services.filter((s) => s.active);
    return (
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Bookable services this bot offers</Label>
          {activeServices.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No services yet — create them under Home → Bookings, then come
              back here.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {activeServices.map((s) => {
                // Empty selection = every service; chips show the explicit set.
                const active =
                  cfg.serviceIds.length === 0 || cfg.serviceIds.includes(s.id);
                return (
                  <Chip
                    key={s.id}
                    size="sm"
                    selected={active}
                    onClick={() => {
                      const explicit =
                        cfg.serviceIds.length === 0
                          ? activeServices.map((x) => x.id)
                          : cfg.serviceIds;
                      const next = explicit.includes(s.id)
                        ? explicit.filter((id) => id !== s.id)
                        : [...explicit, s.id];
                      onChange({
                        ...action,
                        config: {
                          ...cfg,
                          serviceIds:
                            next.length === activeServices.length ? [] : next,
                        },
                      });
                    }}
                  >
                    {s.emoji ? `${s.emoji} ` : ""}
                    {s.name}
                  </Chip>
                );
              })}
            </div>
          )}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Confirmation</Label>
            <NativeSelect
              value={cfg.autoConfirm ? "auto" : "pending"}
              onChange={(e) =>
                onChange({
                  ...action,
                  config: { ...cfg, autoConfirm: e.target.value === "auto" },
                })
              }
            >
              <option value="auto">Confirm instantly</option>
              <option value="pending">Hold as pending for staff review</option>
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Ping channel</Label>
            <NativeSelect
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
            </NativeSelect>
          </div>
        </div>
      </div>
    );
  }

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
            <Label className="text-xs">Ticket type</Label>
            <NativeSelect
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
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Priority</Label>
            <NativeSelect
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
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Tickets land in</Label>
            <NativeSelect
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
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Ping channel</Label>
            <NativeSelect
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
            </NativeSelect>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Details the bot must collect</Label>
          {cfg.fields.map((f, i) => (
            <div key={f.id} className="flex items-center gap-2">
              <Input
                value={f.label}
                onChange={(e) => {
                  const fields = [...cfg.fields];
                  fields[i] = { ...f, label: e.target.value };
                  onChange({ ...action, config: { ...cfg, fields } });
                }}
                placeholder="Items ordered"
                className="h-8 text-sm"
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
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Remove field"
                onClick={() =>
                  onChange({
                    ...action,
                    config: { ...cfg, fields: cfg.fields.filter((x) => x.id !== f.id) },
                  })
                }
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
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
          </Button>
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
        <Label className="text-xs">Escalations post to</Label>
        <NativeSelect
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
        </NativeSelect>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Notify</Label>
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
