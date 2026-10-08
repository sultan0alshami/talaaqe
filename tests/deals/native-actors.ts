import { prisma } from "@/lib/prisma";
import { openSession, resolveSession } from "@/lib/identity";
import { captureOrganizationActor } from "@/lib/organizations/context";
import type { EvidenceTarget } from "../helpers/reviewed-evidence";

// Explicit fixture setup only. Domain calls receive this captured native tuple
// unchanged, including after suspension, role changes or session invalidation.
export async function nativeDealActor(userId: string, target: EvidenceTarget = "test") {
  const taskId = process.env.INFAME_TASK_ID;
  if (process.env.NODE_ENV === "production" || process.env.INFAME_ENV === "production" || !taskId) {
    throw new Error("Native deal actors require an isolated disposable target");
  }
  const rows = await prisma.$queryRaw<Array<{ id: string; kind: string; db: string; host: string }>>`SELECT id, kind, current_database() AS db, host(inet_server_addr()) AS host FROM infame_task_meta.infame_disposable`;
  if (rows.length !== 1 || rows[0].id !== taskId || rows[0].kind !== target || rows[0].db !== `${taskId}_${target}` || rows[0].host !== "127.0.0.1") {
    throw new Error("Native deal actors require the exact guarded database identity");
  }
  const saved = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const token = await openSession(saved.id, saved.sessionVersion, saved.passwordHash);
  const session = await resolveSession(token);
  if (!session) throw new Error("Owned native deal actor failed to resolve");
  return { actor: captureOrganizationActor(session), token };
}
