#!/usr/bin/env node
/**
 * dev-doctor — find and reap orphaned dev processes and dead sandbox state
 * belonging to THIS repo.
 *
 * WHY THIS EXISTS
 * ---------------
 * `next dev` starts the eve runtime as a CHILD process. eve's own cleanup
 * (node_modules/eve/dist/src/public/next/server.js:installProcessShutdown)
 * registers only `process.once("beforeExit")` and `process.once("exit")` —
 * neither of which runs when the parent is terminated by a signal. Verified
 * empirically: SIGTERM to the parent leaves the child alive, reparented to
 * PID 1.
 *
 * So the ONLY clean shutdown path is Ctrl-C in the foreground terminal (SIGINT
 * reaches the whole process group because the child is not detached). Every
 * other stop — `kill <pid>`, `pkill -f "next dev"`, a Next crash, an editor or
 * agent stopping the dev server, closing a terminal in some configurations —
 * orphans `eve dev`.
 *
 * That orphan is not idle. It keeps the eve scheduler running, so
 * apps/agent/agent/schedules/*.md keep firing (morning_ops is `30 2 * * *`)
 * against whatever `.env.local` points at, posting to real Stream channels
 * with nobody watching. It also keeps spawning microsandbox microVMs.
 *
 * Worse, it is silently ADOPTED: apps/agent/.eve/next-dev-server.json records
 * the orphan's origin, and the next `next dev` health-checks that URL and
 * reuses it instead of starting a fresh runtime. A stale orphan running
 * week-old agent code keeps serving, which is one reason agent-file edits look
 * like they "don't hot-reload".
 *
 * USAGE
 *   node scripts/dev-doctor.mjs            # report + reap orphans (runs before `pnpm dev`)
 *   node scripts/dev-doctor.mjs --stop     # stop the whole dev tree, eve child included
 *   node scripts/dev-doctor.mjs --check    # report only; exit 1 if orphans found
 *   node scripts/dev-doctor.mjs --prune    # also delete sandbox/dev-host state older than --days
 *   node scripts/dev-doctor.mjs --prune --days 3
 *   node scripts/dev-doctor.mjs --dry-run  # show what would happen, change nothing
 *
 * ALWAYS stop the dev server with `pnpm dev:stop` (or Ctrl-C) rather than
 * `kill`/`pkill` — that is the whole point of --stop.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, statSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EVE_STATE = join(REPO_ROOT, "apps", "agent", ".eve");
const MSB_HOME = join(homedir(), ".microsandbox");

const argv = process.argv.slice(2);
const CHECK_ONLY = argv.includes("--check");
const DRY_RUN = argv.includes("--dry-run");
const PRUNE = argv.includes("--prune");
const STOP = argv.includes("--stop");
const DAYS = (() => {
  const i = argv.indexOf("--days");
  if (i === -1) return 7;
  const n = Number.parseInt(argv[i + 1] ?? "", 10);
  if (!Number.isFinite(n) || n < 0) {
    console.error("dev-doctor: --days needs a non-negative integer");
    process.exit(2);
  }
  return n;
})();

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

/** Every process on the box, as {pid, ppid, etime, command}. */
function listProcesses() {
  const out = execFileSync("ps", ["-eo", "pid=,ppid=,etime=,command="], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  const rows = [];
  for (const line of out.split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line);
    if (m) rows.push({ pid: +m[1], ppid: +m[2], etime: m[3], command: m[4] });
  }
  return rows;
}

/**
 * An orphan is a process that (a) belongs to this repo and (b) has been
 * reparented to init. Requiring PPID 1 is what keeps this from killing a dev
 * server someone is actively using in another terminal.
 *
 * Under --stop we drop the PPID 1 requirement on purpose: the whole point is
 * to take down the live tree, eve child included, instead of orphaning it.
 */
function findOrphans(procs) {
  const self = selfAncestry(procs);
  const mine = procs.filter(
    (p) => !self.has(p.pid) && p.command.includes(REPO_ROOT),
  );
  return STOP ? mine : mine.filter((p) => p.ppid === 1);
}

/**
 * This process and every ancestor up to init. --stop must never kill the shell
 * or package-manager process that invoked it — when run by an absolute path,
 * those carry REPO_ROOT in their own argv and would otherwise match.
 */
function selfAncestry(procs) {
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  const chain = new Set([process.pid]);
  let cursor = byPid.get(process.pid)?.ppid;
  while (cursor !== undefined && cursor > 1 && !chain.has(cursor)) {
    chain.add(cursor);
    cursor = byPid.get(cursor)?.ppid;
  }
  return chain;
}

/** microVM hosts left behind by a dead eve. Only ever reaped when reparented. */
function findOrphanedVms(procs) {
  return procs.filter(
    (p) =>
      p.ppid === 1 &&
      (p.command.includes(`${MSB_HOME}/bin/msb`) ||
        /\beve-sbx-ses-/.test(p.command)),
  );
}

function kill(pid, signal) {
  try {
    process.kill(pid, signal);
    return true;
  } catch {
    return false;
  }
}

/** SIGTERM, then SIGKILL anything still standing. */
function reap(targets) {
  for (const p of targets) kill(p.pid, "SIGTERM");
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (!targets.some((p) => kill(p.pid, 0))) break;
    execFileSync("sleep", ["0.2"]);
  }
  const stubborn = targets.filter((p) => kill(p.pid, 0));
  for (const p of stubborn) kill(p.pid, "SIGKILL");
  return stubborn.length;
}

function dirSizeBytes(path) {
  try {
    const out = execFileSync("du", ["-sk", path], { encoding: "utf8" });
    return Number.parseInt(out.trim().split(/\s+/)[0], 10) * 1024;
  } catch {
    return 0;
  }
}

function human(bytes) {
  const units = ["B", "KB", "MB", "GB"];
  let n = bytes;
  let u = 0;
  while (n >= 1024 && u < units.length - 1) {
    n /= 1024;
    u += 1;
  }
  return `${n.toFixed(n < 10 && u > 0 ? 1 : 0)} ${units[u]}`;
}

/** Directories under `parent` untouched for more than `days`. */
function staleDirs(parent, days) {
  if (!existsSync(parent)) return [];
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const out = [];
  for (const name of readdirSync(parent)) {
    const path = join(parent, name);
    try {
      const st = statSync(path);
      if (st.isDirectory() && st.mtimeMs < cutoff) out.push(path);
    } catch {
      /* vanished between readdir and stat — fine */
    }
  }
  return out;
}

/**
 * The registry that makes `next dev` adopt a previous runtime. Stale entries
 * are harmless (the health check fails and a fresh server starts), but once
 * the orphan is reaped the file is a lie, so clear it.
 */
function clearDevServerRegistry() {
  const registry = join(EVE_STATE, "next-dev-server.json");
  if (!existsSync(registry)) return null;
  let pid = null;
  try {
    pid = JSON.parse(readFileSync(registry, "utf8")).pid ?? null;
  } catch {
    /* unreadable — remove it anyway */
  }
  const alive = pid !== null && kill(pid, 0);
  if (alive) return { kept: true, pid };
  if (!DRY_RUN && !CHECK_ONLY) rmSync(registry, { force: true });
  return { kept: false, pid };
}

// ---------------------------------------------------------------- run

console.log(c.bold("dev-doctor") + c.dim(` · ${REPO_ROOT}`));

const procs = listProcesses();
const orphans = findOrphans(procs);
const vmOrphans = findOrphanedVms(procs);
const all = [...orphans, ...vmOrphans];

const noun = STOP ? "dev process(es)" : "orphaned process(es) (reparented to init)";

if (all.length === 0) {
  console.log(c.green(STOP ? "✓ nothing running for this repo" : "✓ no orphaned dev processes"));
} else {
  console.log((STOP ? c.yellow : c.red)(`${STOP ? "·" : "✗"} ${all.length} ${noun}:`));
  for (const p of all) {
    const label = /eve[/\\]bin[/\\]eve\.js/.test(p.command)
      ? c.yellow(" [eve runtime — keeps schedules firing]")
      : "";
    console.log(
      `  ${c.dim(`pid ${p.pid}`)} up ${p.etime}${label}\n    ${p.command.slice(0, 150)}`,
    );
  }
  if (CHECK_ONLY || DRY_RUN) {
    console.log(c.dim("  (not reaped: --check/--dry-run)"));
  } else {
    const forced = reap(all);
    console.log(c.green(`  stopped ${all.length}`) + (forced ? c.dim(` (${forced} needed SIGKILL)`) : ""));

    // Killing eve can strand the microVMs it was hosting. Re-scan for hosts
    // that just lost their parent and take those down too.
    const stranded = findOrphanedVms(listProcesses());
    if (stranded.length > 0) {
      reap(stranded);
      console.log(c.green(`  stopped ${stranded.length} stranded microVM host(s)`));
    }
  }
}

const registry = clearDevServerRegistry();
if (registry?.kept) {
  console.log(c.dim(`· eve dev registry points at live pid ${registry.pid} — left alone`));
} else if (registry) {
  console.log(c.dim(`· cleared stale eve dev registry (pid ${registry.pid ?? "?"})`));
}

// Disk state: always reported, only deleted with --prune.
const sandboxes = join(MSB_HOME, "sandboxes");
const devHosts = join(EVE_STATE, "dev-hosts");
const groups = [
  { label: "microsandbox VM state", path: sandboxes },
  { label: "eve dev-hosts", path: devHosts },
];

let reclaimable = 0;
const toDelete = [];
for (const g of groups) {
  if (!existsSync(g.path)) continue;
  const stale = staleDirs(g.path, DAYS);
  const total = readdirSync(g.path).length;
  if (stale.length === 0) {
    console.log(c.dim(`· ${g.label}: ${total} dir(s), none older than ${DAYS}d`));
    continue;
  }
  const bytes = stale.reduce((sum, p) => sum + dirSizeBytes(p), 0);
  reclaimable += bytes;
  toDelete.push(...stale);
  console.log(
    `${PRUNE ? c.yellow("·") : c.dim("·")} ${g.label}: ` +
      `${c.bold(String(stale.length))}/${total} dir(s) older than ${DAYS}d — ${c.bold(human(bytes))}`,
  );
}

if (toDelete.length > 0) {
  if (!PRUNE) {
    console.log(
      c.dim(`  run with --prune to reclaim ${human(reclaimable)} ` +
        `(these are dead sessions' state; eve/microsandbox rebuild what they need)`),
    );
  } else if (DRY_RUN) {
    console.log(c.dim(`  --dry-run: would delete ${toDelete.length} dir(s), ${human(reclaimable)}`));
  } else {
    for (const p of toDelete) rmSync(p, { force: true, recursive: true });
    console.log(c.green(`  pruned ${toDelete.length} dir(s), reclaimed ${human(reclaimable)}`));
  }
}

if (CHECK_ONLY && all.length > 0) process.exit(1);
