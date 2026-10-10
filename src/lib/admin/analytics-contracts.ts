import { z } from "zod";
import { CampaignStatusSchema } from "@/lib/contracts/vocabulary";

export const AdminAnalyticsUnavailableMetrics = Object.freeze(["REVENUE", "SUBSCRIPTIONS", "GROWTH", "MATCH_LATENCY", "ACCEPTANCE_RATE"] as const);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const utc = z.iso.datetime().refine(value => value.endsWith("Z"));
export const AdminAnalyticsQuerySchema = z.object({}).strict();
export const AdminAnalyticsSchema = z.object({
  asOf: utc, scope: z.literal("EARLIER_WORKFLOW_RECORDS"), timeZone: z.literal("UTC"),
  counts: z.object({ campaigns: count, briefVersions: count, matchRuns: count, recommendationRows: count, deals: count, completedDeals: count }).strict(),
  campaignStatuses: z.array(z.object({ status: CampaignStatusSchema, count }).strict()).length(7)
    .refine(rows => rows.every((row, index) => row.status === CampaignStatusSchema.options[index])),
  campaignDays: z.array(z.object({ date: z.iso.date(), count }).strict()).length(7),
  window: z.object({ startsAt: utc, endsAt: utc }).strict(),
  unavailableMetrics: z.array(z.enum(AdminAnalyticsUnavailableMetrics)).length(5)
    .refine(values => values.every((value, index) => value === AdminAnalyticsUnavailableMetrics[index])),
}).strict().superRefine((value, context) => {
  const day = new Date(value.asOf); day.setUTCHours(0, 0, 0, 0);
  const start = new Date(day.getTime() - 6 * 86400000);
  if (!Number.isFinite(day.getTime()) || !Number.isFinite(start.getTime())) {
    context.addIssue({ code: "custom", message: "Invalid stored analytics instant" }); return;
  }
  if (value.window.endsAt !== value.asOf || value.window.startsAt !== start.toISOString()
    || value.campaignDays.some((row, index) => row.date !== new Date(start.getTime() + index * 86400000).toISOString().slice(0, 10))
    || value.counts.completedDeals > value.counts.deals
    || value.campaignStatuses.reduce((total, row) => total + BigInt(row.count), BigInt(0)) !== BigInt(value.counts.campaigns)
    || value.campaignDays.reduce((total, row) => total + BigInt(row.count), BigInt(0)) > BigInt(value.counts.campaigns)) {
    context.addIssue({ code: "custom", message: "Invalid stored analytics snapshot" });
  }
});
export type AdminAnalyticsDTO = z.infer<typeof AdminAnalyticsSchema>;
