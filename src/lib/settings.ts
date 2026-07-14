// AppSetting store — admin-editable runtime configuration, read on the hot
// path (every AI call), so rows are memoized briefly. Writes go through
// setSettings which busts the cache in this instance; other instances (if
// any) pick changes up within TTL_MS.
import { prisma } from "./prisma";

const TTL_MS = 30_000;
let cache: { at: number; map: Map<string, string> } | null = null;

export async function getSettings(): Promise<Map<string, string>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.map;
  const rows = await prisma.appSetting.findMany();
  cache = { at: Date.now(), map: new Map(rows.map((r) => [r.key, r.value])) };
  return cache.map;
}

/** Upsert string values; null deletes the key. */
export async function setSettings(entries: Record<string, string | null>) {
  await prisma.$transaction(
    Object.entries(entries).map(([key, value]) =>
      value === null
        ? prisma.appSetting.deleteMany({ where: { key } })
        : prisma.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } })
    )
  );
  cache = null;
}

export function invalidateSettingsCache() {
  cache = null;
}
