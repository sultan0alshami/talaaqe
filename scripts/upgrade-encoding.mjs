// One-time task-only encoding repair. Keeps original databases and private dump backups.
// Never reset, drop, overwrite, terminate clients or touch source/production targets.
import { Client } from "pg";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, openSync, closeSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { taskState, assertLocalTarget, workspace } from "./task-state.mjs";
const state = taskState();
for (const kind of ["dev", "test", "e2e"]) assertLocalTarget(state, kind);
const locks = [];
const platform = process.platform === "win32" ? "windows" : process.platform;
const binary = await import(`@embedded-postgres/${platform}-${process.arch}`);
const extension = process.platform === "win32" ? ".exe" : "";
const directory = process.env.INFAME_PG_CLIENT_DIR ? path.resolve(process.env.INFAME_PG_CLIENT_DIR) : path.dirname(binary.pg_ctl);
if (process.env.INFAME_PG_CLIENT_DIR && !directory.startsWith(path.resolve(workspace, ".infame") + path.sep)) throw new Error("Custom backup binaries must be inside the isolated task directory");
const backupDirectory = path.resolve(workspace, ".infame", state.id, "encoding-backups");
const boundary = path.resolve(workspace, ".infame", state.id) + path.sep;
if (!backupDirectory.startsWith(boundary)) throw new Error("Backup directory boundary violation");
mkdirSync(backupDirectory, { recursive: true, mode: 0o700 });
const connection = { host: "127.0.0.1", port: state.port, user: state.user, password: state.password, connectionTimeoutMillis: 5000 };
const maintenance = new Client({ ...connection, database: "postgres" });
function identifier(value) {
  if (!new RegExp(`^${state.id}_(dev|test|e2e)(_(utf8_restore|encoding_backup))?$`).test(value)) throw new Error("Database name boundary violation");
  return `"${value}"`;
}
function run(tool, args) {
  const executable = path.join(directory, `${tool}${extension}`);
  if (!existsSync(executable)) throw new Error("Required PostgreSQL backup binary unavailable; configure reviewed task-local INFAME_PG_CLIENT_DIR");
  const result = spawnSync(executable, args, { env: { ...process.env, PGHOST: connection.host, PGPORT: String(state.port), PGUSER: state.user, PGPASSWORD: state.password }, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${tool} failed; original database retained. Inspect the private task state before retrying.`);
}
async function inspect(database, kind) {
  const client = new Client({ ...connection, database });
  await client.connect();
  try {
    const identity = await client.query("SELECT current_database() AS name,host(inet_server_addr()) AS host");
    if (identity.rows[0].name !== database || identity.rows[0].host !== "127.0.0.1") throw new Error("Native database identity mismatch");
    const marker = await client.query('SELECT * FROM "infame_task_meta"."infame_disposable"');
    if (marker.rows.length !== 1 || marker.rows[0].id !== state.id || marker.rows[0].kind !== kind) throw new Error("Disposable marker mismatch");
    const tables = await client.query("SELECT schemaname,tablename FROM pg_tables WHERE schemaname IN ('public','infame_task_meta') ORDER BY schemaname,tablename");
    const counts = {};
    for (const row of tables.rows) {
      const quote = (value) => '"' + value.replaceAll('"', '""') + '"';
      counts[`${row.schemaname}.${row.tablename}`] = (await client.query(`SELECT count(*)::text AS count FROM ${quote(row.schemaname)}.${quote(row.tablename)}`)).rows[0].count;
    }
    return counts;
  } finally { await client.end(); }
}
try {
  for (const kind of ["dev", "test", "e2e"]) {
    const filename = path.join(workspace, ".infame", `${kind}.lock`);
    const fd = openSync(filename, "wx", 0o600); locks.push({ fd, filename });
    writeFileSync(fd, JSON.stringify({ pid: process.pid, operation: "encoding-upgrade" }));
  }
  await maintenance.connect();
  for (const kind of ["dev", "test", "e2e"]) {
    const original = state.targets[kind], restored = `${original}_utf8_restore`, backup = `${original}_encoding_backup`;
    const encoding = await maintenance.query("SELECT pg_encoding_to_char(encoding) AS value FROM pg_database WHERE datname=$1", [original]);
    if (encoding.rows[0]?.value === "UTF8") { console.log(`${kind}: UTF-8 already preserved; no changes.`); continue; }
    if (!encoding.rows.length) throw new Error("Original task database missing; inspect without creating");
    const conflicting = await maintenance.query("SELECT datname FROM pg_database WHERE datname=ANY($1)", [[restored, backup]]);
    if (conflicting.rows.length) throw new Error("Prior encoding conversion state exists; inspect without overwriting");
    const active = await maintenance.query("SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=$1", [original]);
    if (active.rows[0].count !== 0) throw new Error("Task database has active clients; close them before conversion");
    const before = await inspect(original, kind);
    const dump = path.join(backupDirectory, `${kind}.dump`);
    if (existsSync(dump)) throw new Error("Prior backup file exists; inspect without overwriting");
    run("pg_dump", ["--dbname", original, "--format=custom", "--encoding=UTF8", "--file", dump]);
    await maintenance.query(`CREATE DATABASE ${identifier(restored)} TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'`);
    run("pg_restore", ["--dbname", restored, "--exit-on-error", "--single-transaction", dump]);
    const after = await inspect(restored, kind);
    if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error("Restored table counts differ; originals retained");
    const restoredEncoding = await maintenance.query("SELECT pg_encoding_to_char(encoding) AS value FROM pg_database WHERE datname=$1", [restored]);
    if (restoredEncoding.rows[0]?.value !== "UTF8") throw new Error("Restore encoding mismatch");
    // Both databases are idle. If the second rename fails, the first remains as the backup.
    await maintenance.query(`ALTER DATABASE ${identifier(original)} RENAME TO ${identifier(backup)}`);
    await maintenance.query(`ALTER DATABASE ${identifier(restored)} RENAME TO ${identifier(original)}`);
    console.log(`${kind}: UTF-8 restored; all ${Object.keys(before).length} table counts preserved. Original and dump backups retained.`);
  }
} finally {
  await maintenance.end();
  for (const { fd, filename } of locks.reverse()) { closeSync(fd); unlinkSync(filename); }
}
