import { openSync, closeSync, readFileSync, unlinkSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { Client } from "pg";
import { taskState, assertLocalTarget, workspace } from "../scripts/task-state.mjs";
export default async function setup() {
  const state = taskState();
  const url = assertLocalTarget(state, "test");
  const lockPath = path.join(workspace, ".infame", "test.lock");
  let ownLock;
  const inherited = existsSync(lockPath) ? JSON.parse(readFileSync(lockPath, "utf8")) : null;
  if (!inherited || !process.env.INFAME_TARGET_LOCK_TOKEN || inherited.token !== process.env.INFAME_TARGET_LOCK_TOKEN) {
    ownLock = openSync(lockPath, "wx", 0o600);
    writeFileSync(ownLock, JSON.stringify({ pid: process.pid, token: randomBytes(16).toString("hex") }));
  }
  try {
    const client = new Client({ connectionString: url, connectionTimeoutMillis: 5000 });
    await client.connect();
    try {
      const identity = await client.query('SELECT current_database() AS db, host(inet_server_addr()) AS host, id, kind FROM "infame_task_meta"."infame_disposable"');
      if (identity.rowCount !== 1 || identity.rows[0].db !== state.targets.test || identity.rows[0].host !== "127.0.0.1" || identity.rows[0].id !== state.id || identity.rows[0].kind !== "test") throw new Error("Tests require exact isolated database/marker identity");
    } finally { await client.end(); }
  } catch (error) {
    if (ownLock !== undefined) { closeSync(ownLock); unlinkSync(lockPath); }
    throw error;
  }
  return () => { if (ownLock !== undefined) { closeSync(ownLock); unlinkSync(lockPath); } };
}
