import { randomBytes } from "node:crypto";
import { openSync, closeSync, writeFileSync, readFileSync, existsSync, renameSync, unlinkSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { workspace, stateFile, taskState, assertLocalTarget } from "./task-state.mjs";
import { assertOwnedRotationConfiguration } from "./rotation-preflight.mjs";

// Incident recovery for this task's local cluster only. Never prints credentials.
if (process.env.NODE_ENV === "production" || process.env.INFAME_ENV === "production") throw new Error("Local credential rotation forbidden in production");
const state = taskState();
if (!/^[a-z_][a-z0-9_]{0,60}$/.test(state.user)) throw new Error("Unexpected disposable role identity");
const locks = [];
const kindList = ["dev", "test", "e2e"];
const nextState = { ...state, password: randomBytes(32).toString("hex"), authSecret: randomBytes(48).toString("hex") };
let recoveryWritten = false;
const recoveryPath = path.join(workspace, ".infame", "credential-rotation-recovery.json");
if (existsSync(recoveryPath)) throw new Error("Previous rotation journal needs private recovery review");
try {
  for (const kind of kindList) {
    const filename = path.join(workspace, ".infame", `${kind}.lock`);
    const fd = openSync(filename, "wx", 0o600);
    writeFileSync(fd, JSON.stringify({ pid: process.pid, token: randomBytes(16).toString("hex") }));
    locks.push({ fd, filename });
  }
  // Validate every owned configuration before any password change. A duplicate
  // key or partial previous rewrite must never strand the current app config.
  const envFiles = kindList.map((kind) => {
    const envFile = path.join(workspace, kind === "dev" ? ".env.local" : `.env.${kind}.local`);
    const existing = readFileSync(envFile, "utf8");
    const expected = { DATABASE_URL: assertLocalTarget(state, kind), AUTH_SECRET: state.authSecret, INFAME_TASK_ID: state.id, INFAME_ENV: kind === "dev" ? "development" : "test" };
    assertOwnedRotationConfiguration(existing, expected);
    if (existsSync(`${envFile}.rotation`)) throw Object.assign(new Error("Private rotation temporary requires review"), { code: "PRIVATE_RECOVERY_REQUIRED" });
    return { kind, envFile, existing };
  });
  if (existsSync(`${stateFile}.rotation`)) throw Object.assign(new Error("Private rotation temporary requires review"), { code: "PRIVATE_RECOVERY_REQUIRED" });
  for (const kind of kindList) {
    const client = new Client({ connectionString: assertLocalTarget(state, kind), connectionTimeoutMillis: 5000 });
    await client.connect();
    try {
      const identity = await client.query("SELECT current_database() AS db, host(inet_server_addr()) AS host");
      const marker = await client.query('SELECT * FROM "infame_task_meta"."infame_disposable"');
      if (identity.rows[0].db !== state.targets[kind] || identity.rows[0].host !== "127.0.0.1" || marker.rowCount !== 1 || marker.rows[0].id !== state.id || marker.rows[0].kind !== kind) throw new Error("Disposable identity mismatch");
    } finally { await client.end(); }
  }
  const client = new Client({ connectionString: assertLocalTarget(state, "dev"), connectionTimeoutMillis: 5000 });
  await client.connect();
  try {
    // Password changes reject new logins but do not close existing pools. Stop
    // the owned app and workers first; refuse rotation while any pool remains.
    const pools = await client.query("SELECT 1 FROM pg_stat_activity WHERE usename=$1 AND pid<>pg_backend_pid() LIMIT 1", [state.user]);
    if (pools.rowCount) throw Object.assign(new Error("Stop task application pools before local rotation"), { code: "LOCAL_POOLS_ACTIVE" });
    writeFileSync(recoveryPath, JSON.stringify({ oldState: state, nextState }), { mode: 0o600, flag: "wx" });
    recoveryWritten = true;
    await client.query(`ALTER ROLE "${state.user}" PASSWORD '${nextState.password}'`);
  }
  finally { await client.end(); }
  for (const { kind, envFile, existing } of envFiles) {
    const replacements = { DATABASE_URL: assertLocalTarget(nextState, kind), AUTH_SECRET: nextState.authSecret };
    let next = existing;
    for (const [key, value] of Object.entries(replacements)) {
      if (!new RegExp(`^${key}=`, "m").test(next)) throw new Error("Missing owned configuration key");
      next = next.replace(new RegExp(`^${key}=.*$`, "m"), `${key}=${value}`);
    }
    writeFileSync(`${envFile}.rotation`, next, { mode: 0o600, flag: "wx" });
    renameSync(`${envFile}.rotation`, envFile);
  }
  writeFileSync(`${stateFile}.rotation`, JSON.stringify(nextState), { mode: 0o600, flag: "wx" });
  renameSync(`${stateFile}.rotation`, stateFile);
  for (const kind of kindList) {
    const client = new Client({ connectionString: assertLocalTarget(nextState, kind), connectionTimeoutMillis: 5000 });
    await client.connect();
    try {
      await client.query('UPDATE "AuthSession" SET "revokedAt" = CURRENT_TIMESTAMP WHERE "revokedAt" IS NULL');
      await client.query('UPDATE "AuthToken" SET "expiresAt" = LEAST("expiresAt", CURRENT_TIMESTAMP) WHERE "usedAt" IS NULL');
      await client.query("SELECT 1");
    } finally { await client.end(); }
  }
  const oldClient = new Client({ connectionString: assertLocalTarget(state, "dev"), connectionTimeoutMillis: 5000 });
  let rejected = false;
  try { await oldClient.connect(); }
  catch (error) { if (error?.code !== "28P01") throw new Error("Old credential rejection check inconclusive"); rejected = true; }
  finally { await oldClient.end(); }
  if (!rejected) throw new Error("Old disposable credential still accepted");
  unlinkSync(recoveryPath);
  recoveryWritten = false;
  console.log("Rotated task-local database password and session secret; verified all three native targets and revoked old sessions/pending tokens. Saved data and task identity preserved.");
} catch (error) {
  console.error("Local credential rotation failed", typeof error?.code === "string" ? error.code : "SANITIZED_FAILURE", recoveryWritten ? "Private recovery journal retained." : "No credential mutation started.");
  process.exitCode = 1;
} finally {
  for (const { fd, filename } of locks.reverse()) { closeSync(fd); unlinkSync(filename); }
}
