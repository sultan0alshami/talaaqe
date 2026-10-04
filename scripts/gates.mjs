import { spawnSync } from "node:child_process";
import path from "node:path";
const commands = [["typescript/bin/tsc", "--noEmit"], ["eslint/bin/eslint.js", ".", "--max-warnings", "0"], ["TASK", "scripts/task.mjs", "test", "test"], ["next/dist/bin/next", "build", "--webpack"], ["TASK", "scripts/check-build-traces.mjs"]];
for (const [binary, ...args] of commands) {
  const result = spawnSync(process.execPath, binary === "TASK" ? args : [path.resolve("node_modules", binary), ...args], { stdio: "inherit", env: process.env });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
