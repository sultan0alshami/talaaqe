import type { MetricsSnapshot } from "@prisma/client";
import { z } from "zod";
import { VisibilitySchema } from "@/lib/contracts/vocabulary";

// Shared original command validation; no storage or provider imports.
export const SnapshotFieldVisibilitySchema = z.record(
  z.string().regex(/^(followers|averageViews|engagementRate|demographics\.(age|gender|countries|cities)|formatMetrics\.(STORY|POST|REEL|LIVE|CAMPAIGN|VIDEO|SHORT))$/),
  VisibilitySchema,
).refine(value => Object.keys(value).length > 0 && Object.keys(value).length <= 20);
export const SnapshotSharingCommandSchema = z.object({
  operationKey: z.string().min(1).max(120).regex(/^[A-Za-z0-9_:-]+$/),
  expectedMappingRevision: z.number().int().positive(),
  expectedEvidenceRevision: z.number().int().positive(),
  visibility: SnapshotFieldVisibilitySchema,
}).strict();

export function metricFields(snapshot: Pick<MetricsSnapshot, "followers" | "averageViews" | "engagementRate" | "demographics" | "formatMetrics">) {
  const fields: string[] = [];
  if (snapshot.followers !== null) fields.push("followers");
  if (snapshot.averageViews !== null) fields.push("averageViews");
  if (snapshot.engagementRate !== null) fields.push("engagementRate");
  const demographics = snapshot.demographics && !Array.isArray(snapshot.demographics) && typeof snapshot.demographics === "object" ? snapshot.demographics : {};
  for (const key of ["age", "gender", "countries", "cities"]) if (demographics[key] !== null && demographics[key] !== undefined) fields.push("demographics." + key);
  if (Array.isArray(snapshot.formatMetrics)) for (const row of snapshot.formatMetrics) {
    const format = row && !Array.isArray(row) && typeof row === "object" ? row.format : undefined;
    if (typeof format === "string") fields.push("formatMetrics." + format);
  }
  return fields;
}
