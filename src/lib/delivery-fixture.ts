import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { runtimeConfig } from "./env";
import { prisma } from "./prisma";
import type { TokenPurpose } from "./identity";

// Development-only fixture transport. The production entry point excludes this
// module before tracing; this guard also denies any direct production invocation.
export async function deliverFixtureAuthLink(input: { id: string; email: string; purpose: TokenPurpose; token: string }): Promise<"fixture"> {
  if (process.env.NODE_ENV === "production") throw new Error("Fixture delivery forbidden in production");
  const config = runtimeConfig();
  if (config.DELIVERY_MODE !== "fixture") throw new Error("Fixture delivery not enabled");
  const route = input.purpose === "VERIFY_EMAIL" ? "/verify-email" : "/reset-password";
  const link = new URL(route, config.APP_ORIGIN);
  link.searchParams.set("token", input.token);
    // Resolve the runtime checkout, not CLI import.meta metadata: Next bundles
    // imported modules. Validate the native marker before writing any token.
    const workspace = process.cwd();
    const state = JSON.parse(await readFile(path.join(workspace, ".infame", "task.json"), "utf8")) as { id: string; port: number; user: string; password: string; targets: Record<string, string> };
    if (!/^infame_[a-f0-9]{12}$/.test(state.id) || process.env.INFAME_TASK_ID !== state.id || !Number.isInteger(state.port) || state.port < 5644 || state.port > 65000) throw new Error("Fixture task identity mismatch");
    const kind = ["dev", "test", "e2e"].find((target) => state.targets[target] === `${state.id}_${target}` && new URL(`postgresql://${encodeURIComponent(state.user)}:${encodeURIComponent(state.password)}@127.0.0.1:${state.port}/${state.targets[target]}`).href === config.DATABASE_URL);
    if (!kind) throw new Error("Fixture delivery requires exact disposable task target");
    const marker = await prisma.$queryRaw<Array<{ id: string; kind: string; db: string; host: string }>>`SELECT id, kind, current_database() AS db, host(inet_server_addr()) AS host FROM infame_task_meta.infame_disposable`;
    if (marker.length !== 1 || marker[0].id !== state.id || marker[0].kind !== kind || marker[0].db !== state.targets[kind] || marker[0].host !== "127.0.0.1") throw new Error("Fixture native database identity mismatch");
    const directory = path.join(workspace, ".infame", state.id);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await appendFile(path.join(directory, `deliveries-${kind}.jsonl`), JSON.stringify({ id: input.id, email: input.email, purpose: input.purpose, link: link.href, createdAt: new Date().toISOString() }) + "\n", { mode: 0o600 });
    return "fixture";
}
