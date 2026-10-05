import { z } from "zod";
import { CountryCodeSchema, PlatformSchema } from "@/lib/contracts/vocabulary";
import { MoneySchema } from "@/lib/contracts/money";
import { bandForFollowers, ReachBandSchema, REACH_TAXONOMY_VERSION } from "@/lib/commercial/contracts";

export const DISCOVERY_SCOPE = "PUBLIC_PROFILES" as const;
export const DISCOVERY_LIMITS = Object.freeze({ creators: 12, publicAccounts: 100, ownerUsers: 12, reviewerUsers: 2412 });
export const DISCOVERY_FRESHNESS_MS = 90 * 24 * 60 * 60 * 1000;
export class DiscoveryError extends Error {
  constructor(public readonly code: string, public readonly status = 503) { super(code); this.name = "DiscoveryError"; }
}
export const PublicFollowersSchema = z.object({
  followers: MoneySchema.shape.amountMinor, source: z.literal("SCREENSHOT_VERIFIED"),
  observedAt: z.iso.datetime(), taxonomyVersion: z.literal(REACH_TAXONOMY_VERSION),
  band: ReachBandSchema.nullable(),
}).strict().refine(value => {
  const followers = MoneySchema.shape.amountMinor.safeParse(value.followers);
  return followers.success && value.band === bandForFollowers(BigInt(followers.data));
});
export const PublicDiscoveryAccountSchema = z.object({
  platform: PlatformSchema, handle: z.string().min(1).max(200), ownership: z.literal("VERIFIED"),
  followersObservation: PublicFollowersSchema.nullable(),
}).strict();
export const PublicDiscoveryCreatorSchema = z.object({
  id: z.string().min(1).max(200), handle: z.string().min(3).max(30),
  displayName: z.string().min(1).max(500), bio: z.string().max(1000),
  residenceCountryCode: CountryCodeSchema.nullable(),
  languages: z.array(z.string().min(1).max(100)).max(20),
  nicheSlugs: z.array(z.string().min(1).max(100)).max(20),
  accounts: z.array(PublicDiscoveryAccountSchema).max(DISCOVERY_LIMITS.publicAccounts),
}).strict();
export type PublicDiscoveryCreator = z.infer<typeof PublicDiscoveryCreatorSchema>;
export type PublicDiscoveryAccount = z.infer<typeof PublicDiscoveryAccountSchema>;
export const DiscoveryQuerySchema = z.object({
  scope: z.literal(DISCOVERY_SCOPE).default(DISCOVERY_SCOPE),
  q: z.string().max(120).transform(value => value.trim()).default(""),
  residenceCountryCode: CountryCodeSchema.optional(), platform: PlatformSchema.optional(),
  reachBand: ReachBandSchema.optional(), limit: z.coerce.number().int().min(1).max(DISCOVERY_LIMITS.creators).default(DISCOVERY_LIMITS.creators),
  cursor: z.string().min(1).max(2048).regex(/^[A-Za-z0-9_-]+$/).optional(),
}).strict();
export type DiscoveryQuery = z.infer<typeof DiscoveryQuerySchema>;
export const DiscoveryPageSchema = z.object({
  scope: z.literal(DISCOVERY_SCOPE), asOf: z.iso.datetime(),
  creators: z.array(PublicDiscoveryCreatorSchema).max(DISCOVERY_LIMITS.creators),
  nextCursor: z.string().min(1).max(2048).regex(/^[A-Za-z0-9_-]+$/).nullable(),
}).strict();
export type DiscoveryPage = z.infer<typeof DiscoveryPageSchema>;
