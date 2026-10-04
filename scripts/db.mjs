// Reviewed adaptation of Talaqee's embedded-Postgres runner. Task data only.
import EmbeddedPostgres from "embedded-postgres";
import { existsSync, mkdirSync } from "node:fs";
import { taskState, assertLocalTarget } from "./task-state.mjs";
const state = taskState();
for (const target of ["dev", "test", "e2e"]) assertLocalTarget(state, target);
mkdirSync(state.cluster, { recursive: true });
const firstRun = !existsSync(`${state.cluster}/PG_VERSION`);
if (existsSync(`${state.cluster}/postmaster.pid`)) throw new Error("Cluster has a postmaster lock. Check its process before restarting; never remove a live lock.");
if (typeof process.getuid === "function" && process.getuid() === 0) throw new Error("PostgreSQL requires a non-root runtime. Use an existing non-root task user or disposable service; this runner does not mutate system users.");
const pg = new EmbeddedPostgres({
  databaseDir: state.cluster, user: state.user, password: state.password,
  port: state.port, persistent: true, authMethod: "scram-sha-256",
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
  postgresFlags: ["-h", "127.0.0.1"], onLog: () => {}, onError: () => {},
});
if (firstRun) await pg.initialise();
await pg.start();
const client = pg.getPgClient();
await client.connect();
for (const kind of ["dev", "test", "e2e"]) {
  const name = state.targets[kind];
  const found = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
  if (!found.rowCount) await client.query(`CREATE DATABASE "${name}" TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'`);
  const encoding = await client.query("SELECT pg_encoding_to_char(encoding) AS value FROM pg_database WHERE datname=$1", [name]);
  if (encoding.rows[0].value !== "UTF8") {
    await client.end(); await pg.stop();
    throw new Error("Task database needs a preserved UTF-8 upgrade: npm run db:utf8. No database reset performed.");
  }
}
await client.end();
console.log(`Infame PostgreSQL ready on loopback port ${state.port}; development, test and E2E targets are separate. Credentials remain in ignored task files.`);
let stopping = false;
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, async () => {
    if (stopping) return;
    stopping = true;
    await pg.stop();
    process.exit(0);
  });
}
