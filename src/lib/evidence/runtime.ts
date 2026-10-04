import { prisma } from "@/lib/prisma";
import { runtimeConfig } from "@/lib/env";
import { createLocalEvidenceStorage, createSupabaseEvidenceStorage, EvidenceError } from "./storage";
import type { EvidenceActor, EvidenceOptions } from "./common";

// Server composition only. Request bodies cannot choose storage, database,
// environment, historical clock or authentication context.
export async function evidenceOptionsForSession(session: EvidenceActor): Promise<EvidenceOptions> {
  const config = runtimeConfig();
  const serverAuth = { userId: session.userId, role: session.role, sessionId: session.sessionId, sessionVersion: session.sessionVersion };
  if (config.EVIDENCE_STORAGE_MODE === "unavailable") throw new EvidenceError("CAPABILITY_UNAVAILABLE", 503);
  if (config.EVIDENCE_STORAGE_MODE === "supabase") return { serverAuth, storage: createSupabaseEvidenceStorage({
    url: config.SUPABASE_URL!, serviceKey: config.SUPABASE_SERVICE_ROLE_KEY!, bucket: config.SUPABASE_EVIDENCE_BUCKET,
  }) };
  if (process.env.NODE_ENV === "production") throw new EvidenceError("UNSAFE_LOCAL_STORAGE", 503);
  const taskId = process.env.INFAME_TASK_ID;
  const target = (["dev", "test", "e2e"] as const).find(kind => new URL(config.DATABASE_URL).pathname.slice(1) === `${taskId}_${kind}`);
  if (!taskId || !/^infame_[a-f0-9]{12}$/.test(taskId) || !target) throw new EvidenceError("UNSAFE_LOCAL_STORAGE", 503);
  try {
    const markers = await prisma.$queryRaw<Array<{ id: string; kind: string; db: string; host: string }>>`SELECT id, kind, current_database() AS db, host(inet_server_addr()) AS host FROM infame_task_meta.infame_disposable`;
    if (markers.length !== 1 || markers[0]!.id !== taskId || markers[0]!.kind !== target || markers[0]!.db !== `${taskId}_${target}` || markers[0]!.host !== "127.0.0.1") throw new EvidenceError("UNSAFE_LOCAL_STORAGE", 503);
  } catch { throw new EvidenceError("UNSAFE_LOCAL_STORAGE", 503); }
  return { serverAuth, storage: await createLocalEvidenceStorage({ taskId, target }) };
}
