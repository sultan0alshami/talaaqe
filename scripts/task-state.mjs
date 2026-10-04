import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
export const workspace = path.resolve(import.meta.dirname, "..");
export const stateFile = path.join(workspace, ".infame", "task.json");
export function taskState() {
  if (!existsSync(stateFile)) throw new Error("Run npm run setup:local first");
  const state = JSON.parse(readFileSync(stateFile, "utf8"));
  if (!/^infame_[a-f0-9]{12}$/.test(state.id)) throw new Error("Invalid disposable task identity");
  if (process.env.INFAME_TASK_ID && process.env.INFAME_TASK_ID !== state.id) throw new Error("Task identity mismatch; do not reuse another task's data");
  return state;
}
export function assertLocalTarget(state, kind) {
  if (process.env.NODE_ENV === "production" || process.env.INFAME_ENV === "production") throw new Error("Refusing disposable operation in production");
  if (!["dev", "test", "e2e"].includes(kind)) throw new Error("Unknown target");
  if (state.targets[kind] !== `${state.id}_${kind}`) throw new Error("Target is not bound to this task");
  if (!Number.isInteger(state.port) || state.port < 5644 || state.port > 65000) throw new Error("Unsafe database port");
  if (path.resolve(state.cluster) !== path.join(workspace, ".infame", state.id, "pgdata")) throw new Error("Unsafe data directory");
  return new URL(`postgresql://${encodeURIComponent(state.user)}:${encodeURIComponent(state.password)}@127.0.0.1:${state.port}/${state.targets[kind]}`).href;
}
