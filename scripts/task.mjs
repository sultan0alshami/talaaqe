import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync, readFileSync, openSync, closeSync, unlinkSync } from "node:fs";
import path from "node:path";
import net from "node:net";
import { spawnSync } from "node:child_process";
import { Client } from "pg";
import { workspace, stateFile, taskState, assertLocalTarget } from "./task-state.mjs";
const [action = "init", kind = "dev"] = process.argv.slice(2);
if (!["init", "prepare", "migrate", "seed", "reset", "e2e", "test", "verify"].includes(action)) throw new Error("Unknown task command");
function reconcile(state) {
  for (const target of ["dev", "test", "e2e"]) {
    const filename = target === "dev" ? ".env.local" : `.env.${target}.local`;
    const file = path.join(workspace, filename);
    const expected = `DATABASE_URL=${assertLocalTarget(state, target)}\nAUTH_SECRET=${state.authSecret}\nAPP_ORIGIN=http://localhost:${target === "e2e" ? 3100 : 3000}\nINFAME_TASK_ID=${state.id}\nINFAME_ENV=${target === "dev" ? "development" : "test"}\nDELIVERY_MODE=fixture\n`;
    if (!existsSync(file)) writeFileSync(file, expected, { mode: 0o600, flag: "wx" });
    else {
      const contents = readFileSync(file, "utf8");
      const pairs = Object.fromEntries(contents.split(/\r?\n/).filter(line => line.includes("=")).map(line => { const eq = line.indexOf("="); return [line.slice(0, eq), line.slice(eq + 1)]; }));
      if (pairs.DATABASE_URL !== assertLocalTarget(state, target) || pairs.AUTH_SECRET !== state.authSecret || pairs.INFAME_TASK_ID !== state.id) throw new Error("Existing task configuration mismatch; review without overwriting");
    }
  }
}
function run(bin, args, env) {
  const result = spawnSync(process.execPath, [path.join(workspace, "node_modules", bin), ...args], { cwd: workspace, env, stdio: "inherit" });
  if (result.status !== 0) throw new Error(`Command failed: ${args[0] ?? bin}`);
}
if (action === "init") {
  if (process.env.NODE_ENV === "production" || process.env.INFAME_ENV === "production") throw new Error("Local initialization forbidden in production");
  mkdirSync(path.dirname(stateFile), { recursive: true });
  const lockPath = `${stateFile}.lock`;
  const lock = openSync(lockPath, "wx", 0o600);
  try {
  if (existsSync(stateFile)) {
    reconcile(taskState());
    console.log("Existing Infame task preserved; no credentials or data overwritten.");
  } else {
    if ([".env", ".env.local", ".env.test.local", ".env.e2e.local"].some(f => existsSync(path.join(workspace, f)))) throw new Error("Existing configuration requires review; refusing overwrite");
    const id = `infame_${randomBytes(6).toString("hex")}`;
    let port = 5644;
    while (port < 65000) {
      const available = await new Promise(resolve => { const s = net.createServer(); s.once("error", () => resolve(false)); s.listen(port, "127.0.0.1", () => s.close(() => resolve(true))); });
      if (available) break;
      port++;
    }
    const state = { id, port, user: "infame_task", password: randomBytes(32).toString("hex"), authSecret: randomBytes(48).toString("hex"), cluster: path.join(workspace, ".infame", id, "pgdata"), targets: { dev: `${id}_dev`, test: `${id}_test`, e2e: `${id}_e2e` } };
    writeFileSync(stateFile, JSON.stringify(state), { mode: 0o600, flag: "wx" });
    reconcile(state);
    console.log(`Created fresh ${id} with three isolated databases; secrets saved only to ignored files.`);
  }
  } finally { closeSync(lock); unlinkSync(lockPath); }
} else {
  const state = taskState();
  const url = assertLocalTarget(state, kind);
  if (action === "reset" && (kind === "dev" || process.argv[4] !== `--disposable=${state.id}`)) throw new Error("Reset requires test/E2E and explicit matching disposable task ID");
  if (action === "e2e" && kind !== "e2e") throw new Error("E2E requires the separate e2e target");
  if (action === "test" && kind !== "test") throw new Error("Tests require the separate test target");
  const targetLockPath = path.join(workspace, ".infame", `${kind}.lock`);
  const targetLock = openSync(targetLockPath, "wx", 0o600);
  const targetLockToken = randomBytes(16).toString("hex");
  writeFileSync(targetLock, JSON.stringify({ pid: process.pid, token: targetLockToken }));
  try {
  const env = { ...process.env, DATABASE_URL: url, AUTH_SECRET: state.authSecret, INFAME_TASK_ID: state.id, INFAME_ENV: kind === "dev" ? "development" : "test", DELIVERY_MODE: "fixture", APP_ORIGIN: `http://localhost:${kind === "e2e" ? 3100 : 3000}` };
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 5000 });
  await client.connect();
  try {
  const identity = await client.query("SELECT current_database() AS db, host(inet_server_addr()) AS host");
  if (identity.rows[0].db !== state.targets[kind] || identity.rows[0].host !== "127.0.0.1") throw new Error("Database identity mismatch");
  if (action === "prepare") await client.query('CREATE SCHEMA IF NOT EXISTS "infame_task_meta"');
  const oldMarker = await client.query("SELECT to_regclass('public.infame_disposable') AS table_name");
  if (action === "prepare" && oldMarker.rows[0].table_name) {
    const old = await client.query('SELECT * FROM public."infame_disposable"');
    if (old.rowCount !== 1 || old.rows[0].id !== state.id || old.rows[0].kind !== kind) throw new Error("Legacy task marker mismatch");
    await client.query('ALTER TABLE public."infame_disposable" SET SCHEMA "infame_task_meta"');
  }
  if (action === "prepare") await client.query('CREATE TABLE IF NOT EXISTS "infame_task_meta"."infame_disposable" (id text PRIMARY KEY, kind text NOT NULL)');
  const marker = await client.query('SELECT * FROM "infame_task_meta"."infame_disposable"');
  if (marker.rowCount > 1 || (marker.rowCount && (marker.rows[0].id !== state.id || marker.rows[0].kind !== kind))) throw new Error("Disposable marker mismatch");
  if (!marker.rowCount && action !== "prepare") throw new Error("Existing disposable marker required");
  if (!marker.rowCount && action === "prepare") await client.query('INSERT INTO "infame_task_meta"."infame_disposable" VALUES ($1, $2)', [state.id, kind]);
  } finally { await client.end(); }
  if (action === "prepare") {
    run("prisma/build/index.js", ["migrate", "deploy"], env);
    run("prisma/build/index.js", ["generate"], env);
    run("tsx/dist/cli.mjs", ["prisma/seed.ts"], env);
  } else if (action === "migrate") run("prisma/build/index.js", ["migrate", "deploy"], env);
  else if (action === "seed") run("tsx/dist/cli.mjs", ["prisma/seed.ts"], env);
  else if (action === "reset") {
    run("prisma/build/index.js", ["migrate", "reset", "--force", "--skip-seed"], env);
  } else if (action === "test") run("vitest/vitest.mjs", ["run", ...process.argv.slice(4)], { ...env, NODE_ENV: "test", INFAME_TARGET_LOCK_TOKEN: targetLockToken });
  else if (action === "e2e") {
    run("@playwright/test/cli.js", ["test", ...process.argv.slice(4)], env);
  } else if (action === "verify") console.log(`Verified ${kind}: native connectivity, loopback, exact database identity and task marker.`);
  else throw new Error("Unknown task command");
  } finally { closeSync(targetLock); unlinkSync(targetLockPath); }
}
