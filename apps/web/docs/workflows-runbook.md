# Workflows — verification run book

End-to-end checks for the AI-powered workflow system landed in migrations
`0026_workflows.sql` + `0027_workflow_templates_seed.sql`. Run these the
first time you bring the system up in any environment, and any time the
data layer or runtime changes meaningfully.

The architecture in one line: events land in `workflow_events` (Postgres
triggers + webhook handlers emit), the dispatcher matches them to enabled
workflows, and the instant runtime (or, eventually, the Vercel Workflow
SDK) executes each step. AI authors specs; users (and AI) build workflows
in `/p/[propertyId]/workflows/[id]`. The full design lives in
`~/.claude/plans/delegated-sauteeing-steele.md`.

## 1. Prerequisites

```bash
# Server
pnpm dev                            # tee's to /tmp/hotelclaw-dev.log

# Env (.env.local)
NEXT_PUBLIC_SUPABASE_URL=…
SUPABASE_SERVICE_ROLE_KEY=…
NEXT_PUBLIC_STREAM_API_KEY=…
STREAM_API_SECRET=…
ANTHROPIC_API_KEY=…
INTERNAL_DISPATCH_SECRET=…         # gate /api/workflows/dispatch
# Optional, for durable runtime:
# (only set after `pnpm add workflow @workflow/ai` and flipping the SDK_INSTALLED flag)
```

## 2. Apply the migrations

```bash
pnpm supabase db push               # local + remote
# or, remote only:
pnpm supabase migration up
```

Sanity-check tables + Postgres triggers landed:

```bash
pnpm supabase db query --linked "
  select count(*) from public.workflows;
  select count(*) from public.workflow_events;
  select count(*) from public.workflow_templates;  -- should be 5 after 0027
  select tgname from pg_trigger
    where tgname in ('tasks_workflow_events_aiu', 'entities_workflow_events_aiu');
"
```

Both triggers should appear. Templates count should be 5.

## 3. Smoke: the outbox + dispatcher race

The fastest way to confirm Postgres triggers + the dispatcher both wire up:

```bash
# Insert a fake task; the AFTER INSERT trigger should drop a row into workflow_events.
pnpm supabase db query --linked "
  insert into public.tasks (property_id, title, created_by, status, priority)
  select id, 'smoke test task', null, 'todo', 'none'
  from public.properties limit 1
  returning id;
"

# Verify the event was captured.
pnpm supabase db query --linked "
  select event_type, source, dispatched_at, matched_workflow_ids
  from public.workflow_events
  order by received_at desc limit 1;
"
```

Expected: `event_type = 'task.created'`, `source = 'pg.tasks'`,
`dispatched_at` populated within ~1 minute (the cron drain interval).

## 4. End-to-end: AI authors a workflow, then it fires

The full happy path. Use your browser.

1. Open `/p/<propertyId>/workflows/new`
2. Type a goal in the bottom AI co-pilot — for example:

   > _When a task is created with the label `guest-complaint`, summarize it
   > and notify all managers._

3. Wait a few seconds. The step-stack should populate with a trigger header
   and two steps (an `ai.summarize_text` and an `action.notify.role`).
4. Click **Create workflow**. You're redirected to the workflow's detail
   page. The mode badge in the trigger header reads "Runs instantly".
5. Flip the workflow on — there's no UI toggle yet, so use the API:

   ```bash
   curl -X PATCH \
     -H "Content-Type: application/json" \
     -b "<your auth cookie>" \
     -d '{"enabled": true}' \
     http://localhost:3000/api/properties/<propertyId>/workflows/<workflowId>
   ```

6. Trigger the workflow: create a task labeled `guest-complaint` in the
   normal UI (`/p/<propertyId>/tasks`). The label triggers `task.label_added`,
   the dispatcher matches, the instant runtime fires the AI summarize step
   and writes a notification.
7. Tail the dev log to watch it run:

   ```bash
   tail -f /tmp/hotelclaw-dev.log | grep -E "workflows:|run-bot|ai-trigger"
   ```

8. Open the run inspector:
   `/p/<propertyId>/workflows/<workflowId>/runs` → click the latest run.
   You should see the trigger event, the two step rows with status
   `succeeded`, and the AI step's `ai_trace` in the expandable JSON view.

## 5. Templates fork

1. Open `/p/<propertyId>/workflows/templates`
2. Click **Fork** on _Lost & found logger_
3. You're routed to the new workflow's builder. The spec contains a chat
   trigger, an `ai.branch_decision`, an `ai.extract_fields`, and a task
   `action.task.create`
4. Turn it on (PATCH as above), then post a chat message like
   `"Found a black wallet near the lobby"` in any team channel
5. Inspect the run — the classifier should return `decision: "true"`, the
   extract should pull `item: "black wallet"`, and a task should be created
   with label `lost-and-found`

## 6. Entities — create a type, then a row, then a workflow that fires on it

1. `/p/<propertyId>/workflows/entities` → **New type**:
   - Display name: `Room`
   - Machine name: `room`
   - Fields: `number` (string, required), `status` (string, required), `floor` (number)
2. Click into the type → **New room**. Create one with
   `number=101, status=clean, floor=1`
3. Verify the entity-trigger fires:

   ```bash
   pnpm supabase db query --linked "
     select event_type, payload->'type', dispatched_at
     from public.workflow_events
     order by received_at desc limit 3;
   "
   ```

   Expected: a row with `event_type='entity.created'` and
   `payload->'type'='room'`
4. Build a workflow with the AI: "When a room status changes to
   `maintenance_needed`, notify managers." The author should emit a
   spec with `trigger.event_type='entity.field_changed'` and
   `trigger.entity_type='room'`
5. Turn the workflow on, then patch the room row's status (via the
   entity UI's edit flow when wired, or directly via SQL). The workflow
   should fire and surface in run inspector

## 7. Cross-surface entry points

Quick checks that the prefilled flow works end-to-end:

- **Kanban**: open `/p/<propertyId>/tasks`. On any column's `⋯` menu,
  click _Automate this column…_. The new-workflow page opens; the AI
  co-pilot fires automatically with a seeded goal mentioning that column
- **Task detail**: open any task detail page. In the right sidebar's
  Actions section, click _Automate from this task…_. The AI fires with a
  seeded goal that references the task's labels (if any)

Both routes funnel through `/workflows/new?prefill=<base64>`; the prefill is
opaque so analytics can carry context without touching the AI persona.

## 8. Run inspector live-tail

While a workflow is running, the inspector subscribes via Supabase Realtime
to `workflow_runs` and `workflow_step_runs` and updates without a refresh.
Test it:

1. Build a workflow with a `ai.freeform` step at the start (takes a few
   seconds to return)
2. Trigger it; immediately open the runs list, then the in-flight run
3. The run header should show status `running` and the AI step row should
   start as `running`, then flip to `succeeded` with output in place — no
   page reload

If the realtime sub doesn't move, check the Realtime publication includes
the table:

```bash
pnpm supabase db query --linked "
  select tablename from pg_publication_tables where pubname='supabase_realtime'
    and tablename in ('workflow_runs', 'workflow_step_runs', 'workflow_events');
"
```

All three should be present (added by `0026_workflows.sql`).

## 9. Common failures

- **`workflow did not fire after the trigger event`** — open the event row
  in `workflow_events` and read `filtered_reason`. Most often: workflow is
  disabled (`'disabled'`), trigger filter predicate is false
  (`'predicate_false'`), or the spec is a stale version pointing at a
  catalog id that no longer exists. The run inspector's "Events" tab
  surfaces the same data
- **`step type … has no runner`** — a control-flow step somehow reached the
  catalog branch in `instant-runtime.ts`. Most often when a new control type
  is added to `spec.ts` without an inline handler in
  `instant-runtime.ts:executeStep`. Add the handler, don't add a runner
- **`durable runtime not yet wired`** in the dev log — expected until you
  run `pnpm add workflow @workflow/ai` and flip the `SDK_INSTALLED` flag in
  `lib/workflows/durable-runtime.ts`. Workflows classified as `durable`
  fall back to the instant runtime; delay / wait_for_event nodes will not
  actually pause
- **AI author returns `{ kind: "error", message: "Bot did not call
  emit_workflow / …" }`** — the model decided the goal needed more context
  but didn't call `ask_clarification`. Usually means the goal is too vague
  to design against. Retry with a more concrete instruction
- **Stream `post_message` action 401s** — the channel id in the spec config
  must be the Stream channel id (the slug part of `prop-…-…`), not the
  internal `chat_channels.id` UUID. The AI usually emits the right shape
  once it has called `list_available_actions` and seen the description

## 10. Optional: enable the durable runtime

Once you're ready to give workflows true delays / wait-for-event / scheduled
fires:

```bash
pnpm add workflow @workflow/ai
```

Then in `next.config.ts`:

```ts
import { withWorkflow } from "workflow/next";
export default withWorkflow(nextConfig);
```

And in `lib/workflows/durable-runtime.ts`:

- Flip `SDK_INSTALLED = true`
- Uncomment the `start(runWorkflowSpec, [args])` block
- Implement `runWorkflowSpec` as a `"use workflow"`-annotated function that
  maps each `StepNode` to a `"use step"` helper, with `sleep("Xm")` for
  `control.delay` and `createHook({ token })` for `control.wait_for_event`

The dispatcher already routes `mode='durable'` workflows here — no caller
changes needed.

## 11. Regression — don't break the existing AI bots

The workflow system reuses `runBot()` for AI steps and adds new
`"workflow"` / `"workflow-step"` surfaces to `BotScope`. Confirm the
channel bot still works:

```bash
node --env-file=.env.local scripts/bot-chat-test.mjs suite
```

Should pass all four modes (mention / auto / always / engaged). If the
suite fails on a test it used to pass, suspect the `BotScope.surface`
union change in `lib/ai/run-bot.ts` or one of the new AI step adapters
in `lib/workflows/runners/ai.ts`.
