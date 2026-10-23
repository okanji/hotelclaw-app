import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { AGENT_TOOL_CATALOG, AGENT_TOOL_IDS } from "@hotelclaw/agent-config";
import { CAPABILITY_TOOL_COVERAGE } from "@/lib/stream/ai-capability-map";

/**
 * Drift guards for the cross-package contracts that have actually broken:
 * catalog ids vs eve executors, channel-bot grants, the eve build-transform
 * naming rules (phantom closure captures took prod down 2026-07-22), and
 * the ChannelEvents hook surface (an unsupported "message.received" key was
 * silently ignored 2026-07-23). These read SOURCE TEXT — cheap tripwires,
 * not proofs — but each one failing has a documented incident behind it.
 */

const repoRoot = join(__dirname, "..", "..", "..", "..", "..");
const agentDir = join(repoRoot, "apps", "agent", "agent");
const read = (...p: string[]) => readFileSync(join(...p), "utf8");

const catalogSrc = read(agentDir, "tools", "catalog.ts");
const memoryProviderSrc = read(agentDir, "lib", "memory-provider.ts");
const memorySlotSrcs = ["property", "person"].map((slot) => read(agentDir, "memory", `${slot}.ts`));
const podToolsSrc = read(agentDir, "tools", "pod-tools.ts");
const agentConfigSrc = read(agentDir, "lib", "agent-config.ts");
const dynamicInstructionsSrc = read(agentDir, "instructions", "dynamic.ts");
const eveChannelSrc = read(agentDir, "channels", "eve.ts");

describe("AGENT_TOOL_CATALOG ↔ eve executor sync", () => {
  it("catalog ids are unique", () => {
    const ids = AGENT_TOOL_CATALOG.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every catalog id has an executor gate in catalog.ts", () => {
    for (const id of AGENT_TOOL_IDS) {
      expect(
        catalogSrc.includes(`grants.has("${id}")`),
        `catalog.ts has no grants.has("${id}") — the Agents UI can grant a tool that doesn't exist`,
      ).toBe(true);
    }
  });

  it("every executor gate in catalog.ts is a real catalog id", () => {
    const gated = [...catalogSrc.matchAll(/grants\.has\("([a-z_]+)"\)/g)].map(
      (m) => m[1],
    );
    for (const id of gated) {
      expect(
        AGENT_TOOL_IDS.has(id),
        `catalog.ts gates on "${id}" which is not in AGENT_TOOL_CATALOG`,
      ).toBe(true);
    }
  });

  it("the channel bot's grants are all real catalog ids", () => {
    // channelBotConfig's tools array, extracted from source.
    const block = agentConfigSrc.match(
      /channelBotConfig\(\)[\s\S]*?tools:\s*\[([\s\S]*?)\]/,
    );
    expect(block, "channelBotConfig tools array not found").toBeTruthy();
    const grants = [...block![1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
    expect(grants.length).toBeGreaterThanOrEqual(15);
    for (const g of grants) {
      expect(AGENT_TOOL_IDS.has(g), `channel bot grants unknown tool "${g}"`).toBe(true);
    }
    // The knowledge-silo closures must stay granted (the SOP incident class).
    for (const required of [
      "search_documents",
      "list_documents",
      "search_tasks",
      "search_chat_messages",
      "guest_conversation_insights",
      "start_background_job",
    ]) {
      expect(grants, `channel bot lost the "${required}" grant`).toContain(required);
    }
  });

  it("the personal assistant's grants are all real catalog ids", () => {
    const block = agentConfigSrc.match(
      /assistantConfig\(\)[\s\S]*?tools:\s*\[([\s\S]*?)\]/,
    );
    expect(block, "assistantConfig tools array not found").toBeTruthy();
    const grants = [...block![1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
    expect(grants.length).toBeGreaterThanOrEqual(15);
    for (const g of grants) {
      expect(AGENT_TOOL_IDS.has(g), `assistant grants unknown tool "${g}"`).toBe(true);
    }
    // start_background_job self-gates on a Stream channel id, which assistant
    // sessions never have — granting it would advertise a capability that can
    // never mount (the persona claims exactly the tools it gets).
    expect(
      grants,
      "assistant must not grant start_background_job — it has no channel to deliver into",
    ).not.toContain("start_background_job");
  });

  it("both virtual bots reach render_ui, and memory is slot-scoped (not slug-gated)", () => {
    // The assistant is a second virtual bot on the channel bot's machinery.
    // Its rich-UI tool mounts from a slug-gated dynamic, so a gate that
    // forgets the new slug silently ships an assistant without cards.
    expect(
      read(agentDir, "tools", "channel-render-ui.ts").includes("ASSISTANT_BOT_SLUG"),
      "channel-render-ui.ts does not admit ASSISTANT_BOT_SLUG — the assistant loses render_ui",
    ).toBe(true);
    // Memory is an eve SLOT (agent/memory/*): every session with a verified
    // propertyId gets it — no slug gate to forget. The scope must come from
    // auth attributes, never from a header the model could influence.
    for (const src of memorySlotSrcs) {
      expect(src).toContain("defineMemory(");
      expect(src).toContain("attributes?.propertyId");
      expect(src).toMatch(/\bnull\b/);
    }
  });

  it("the assistant's project header is stamped as a session attribute", () => {
    // Project instructions/memory/context ride on this attribute; without the
    // stamp every project chat silently runs the plain persona.
    expect(eveChannelSrc).toContain('"x-hotelclaw-project"');
    expect(eveChannelSrc).toContain("projectId");
  });

  it("the auto-mode classifier advertises every channel-bot grant", () => {
    // Auto mode's rule B ("asks for something on the capability list") is one
    // of only two ALWAYS-respond rules, so a grant the blurb never mentions
    // is a capability the bot silently refuses to volunteer. The blurb had
    // drifted to a read-only description of a bot with 47 write-capable
    // grants — this guard is why that can't happen twice.
    const block = agentConfigSrc.match(
      /channelBotConfig\(\)[\s\S]*?tools:\s*\[([\s\S]*?)\]/,
    );
    const grants = [...block![1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
    const advertised = new Set(
      Object.values(CAPABILITY_TOOL_COVERAGE).flatMap((ids) => [...ids]),
    );
    for (const g of grants) {
      expect(
        advertised.has(g),
        `channel bot grants "${g}" but lib/stream/ai-capability-map.ts never advertises it — auto mode will stay silent when someone asks for it`,
      ).toBe(true);
    }
  });

  it("the classifier capability map only lists real catalog tools", () => {
    for (const [line, ids] of Object.entries(CAPABILITY_TOOL_COVERAGE)) {
      for (const id of ids) {
        expect(
          AGENT_TOOL_IDS.has(id),
          `capability line "${line}" advertises "${id}" which is not in AGENT_TOOL_CATALOG`,
        ).toBe(true);
      }
    }
  });

  it("database RPCs referenced by executors exist in migrations", () => {
    const migrationsDir = join(repoRoot, "apps", "web", "supabase", "migrations");
    const allMigrations = readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => read(migrationsDir, f))
      .join("\n");
    for (const rpc of [...catalogSrc.matchAll(/rpc\(\s*"([a-z_]+)"/g)].map((m) => m[1])) {
      expect(
        allMigrations.includes(`function public.${rpc}`),
        `catalog.ts calls rpc "${rpc}" with no defining migration`,
      ).toBe(true);
    }
  });
});

describe("eve build-transform safety (prod incident 2026-07-22)", () => {
  // The Vercel eve build lifts inline executes and captures ANY token in
  // the execute source that matches a resolver-scope binding — including
  // object keys and words inside string literals. `const url` + a `url:`
  // result key elsewhere threw "url is not defined" at resolver time and
  // killed every tool. Collision-prone short names stay banned.
  const dynamicToolModules: Array<[string, string]> = [
    ["catalog.ts", catalogSrc],
    ["memory-provider.ts", memoryProviderSrc],
    ["pod-tools.ts", podToolsSrc],
  ];

  for (const [name, src] of dynamicToolModules) {
    it(`${name} declares no collision-prone resolver locals (url/cred)`, () => {
      expect(src).not.toMatch(/\bconst url\s*=/);
      expect(src).not.toMatch(/\bconst cred\s*=/);
    });
  }

  it("memory provider tools close over plain strings only", () => {
    // The scope object itself must not be captured — the build transform
    // serialises captured values and an object/function capture does not
    // replay. Each executor rebuilds the scope from the string parts.
    expect(memoryProviderSrc).toContain("const memPropertyId = scope.propertyId");
    expect(memoryProviderSrc).toContain("const memSubjectId = scope.subjectId");
    expect(memoryProviderSrc).not.toMatch(/execute\([^)]*\)\s*\{[^}]*\bscope\./);
  });

  it("no shared helper functions are closed over by role-gated executes", () => {
    // A captured FUNCTION serializes into __closureVars and cannot be
    // reconstructed on replay — the check must be inlined per execute.
    expect(catalogSrc).not.toMatch(/const requireManagerSender/);
  });
});

describe("eve channel events surface (silent-ignore incident 2026-07-23)", () => {
  // ChannelEvents (eve dist/src/public/definitions/channel.d.ts) supports a
  // fixed hook set. Unknown keys are silently ignored — a "message.received"
  // handler never fired and the delivery nonce was never stamped.
  // eve 0.83 ChannelEvents (dist/src/public/definitions/channel.d.ts).
  const SUPPORTED = new Set([
    "approval.candidate",
    "approval.settled",
    "context.cleared",
    "compaction.requested",
    "compaction.completed",
    "turn.started",
    "actions.requested",
    "action.partial",
    "action.result",
    "message.completed",
    "message.appended",
    "reasoning.appended",
    "reasoning.completed",
    "step.started",
    "step.completed",
    "input.requested",
    "input.resolved",
    "task.started",
    "task.settled",
    "turn.waiting",
    "turn.failed",
    "turn.completed",
    "turn.cancelled",
    "session.failed",
    "session.completed",
    "session.waiting",
    "authorization.required",
    "authorization.completed",
  ]);

  it("only registers supported event hooks", () => {
    const eventsBlock = eveChannelSrc.match(/events:\s*\{([\s\S]*)\n\s*\},?\n\}\);/);
    expect(eventsBlock, "events block not found in channels/eve.ts").toBeTruthy();
    const keys = [...eventsBlock![1].matchAll(/"([a-z]+\.[a-z]+)":/g)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThanOrEqual(4);
    for (const k of keys) {
      expect(SUPPORTED.has(k), `channels/eve.ts registers unsupported hook "${k}"`).toBe(
        true,
      );
    }
  });

  it("delivery + drain + failure hooks are all registered", () => {
    for (const k of [
      '"message.completed"',
      '"action.result"',
      '"input.requested"',
      // eve ≥ 0.70: a question/approval holds the turn open and parks via
      // turn.waiting {on:"input"} — session.waiting alone would never post
      // the question (prod 2026-07-28 class of bug, now a contract).
      '"turn.waiting"',
      '"session.waiting"',
      '"session.failed"',
    ]) {
      expect(eveChannelSrc).toContain(k);
    }
  });
});

describe("knowledge discipline wiring (SOP incident 2026-07-22)", () => {
  it("per-session instructions inject the shared discipline", () => {
    expect(dynamicInstructionsSrc).toContain("MEMORY_DISCIPLINE");
  });

  it("the knowledge-lookup skill exists with a routing description", () => {
    const skill = read(agentDir, "skills", "knowledge-lookup.md");
    expect(skill).toContain("description:");
    expect(skill).toContain("Absence protocol");
    expect(skill).toContain("list_documents");
    expect(skill).toContain("property__search");
    expect(skill).toContain("property__remember");
  });

  it("the opt-in framework tools the persona relies on are authored (eve ≥ 0.65 made them opt-in)", () => {
    for (const tool of ["ask_question", "no_reply", "sleep"]) {
      expect(() => read(agentDir, "tools", `${tool}.ts`)).not.toThrow();
    }
  });

  it("role-gated tools check the real sender, not the acting principal", () => {
    // The owner-fallback acting principal must never satisfy management
    // gates; each of the three management executors must query the
    // SENDER's own membership (one inlined check per execute — a shared
    // helper would be a non-serializable closure capture).
    const senderChecks = [...catalogSrc.matchAll(/\.eq\("user_id", senderId\)/g)];
    expect(senderChecks.length).toBeGreaterThanOrEqual(3);
  });
});

describe("fleet pod-tool mirror (manual sync contract)", () => {
  it("every fleet catalog id has a pod-tools gate", () => {
    const fleetSrc = read(repoRoot, "apps", "web", "lib", "fleet", "tool-catalog.ts");
    const ids = [...fleetSrc.matchAll(/id:\s*"([a-z_]+)"/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(5);
    for (const id of ids) {
      expect(
        podToolsSrc.includes(`allowed.has("${id}")`),
        `fleet tool-catalog lists "${id}" with no pod-tools executor gate`,
      ).toBe(true);
    }
  });
});
