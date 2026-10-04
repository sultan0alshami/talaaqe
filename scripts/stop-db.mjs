// Graceful stop for the exact task-owned cluster, including Windows managed-shell exits.
import { readFileSync, existsSync, openSync, closeSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { workspace, taskState, assertLocalTarget } from "./task-state.mjs";
const state = taskState();
for (const kind of ["dev", "test", "e2e"]) assertLocalTarget(state, kind);
const pidFile = path.join(state.cluster, "postmaster.pid");
if (!existsSync(pidFile)) { console.log("Task PostgreSQL is already stopped."); process.exit(0); }
const lines = readFileSync(pidFile, "utf8").split(/\r?\n/);
if (path.resolve(lines[1]) !== path.resolve(state.cluster) || Number(lines[3]) !== state.port) throw new Error("Postmaster identity mismatch");
const suffix = process.platform === "win32" ? "windows" : process.platform;
const binary = await import(`@embedded-postgres/${suffix}-${process.arch}`);
const locks = [];
try {
  for (const kind of ["dev", "test", "e2e"]) {
    const filename = path.join(workspace, ".infame", `${kind}.lock`);
    const fd = openSync(filename, "wx", 0o600);
    locks.push({ fd, filename });
    writeFileSync(fd, JSON.stringify({ pid: process.pid, operation: "stop" }));
  }
  const result = spawnSync(binary.pg_ctl, ["stop", "-D", state.cluster, "-m", "fast", "-w"], { stdio: "inherit" });
  if (result.status !== 0) throw new Error("Task PostgreSQL did not stop cleanly");
} finally {
  for (const { fd, filename } of locks.reverse()) { closeSync(fd); unlinkSync(filename); }
}
