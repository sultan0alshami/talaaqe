import { z } from "zod";
import { CountryCodeSchema, UtcDateTimeSchema } from "@/lib/contracts/vocabulary";
import { OrganizationIdSchema as id, OrganizationRevisionSchema as revision } from "@/lib/organizations/contracts";
import { canonicalHash } from "@/lib/onboarding/drafts";
import { PrincipalPartySchema } from "./principal-contracts";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const instant = UtcDateTimeSchema.refine(value => /^[0-9]{4}-/.test(value) && value.slice(0, 4) !== "0000");
const activity = z.string().min(1).max(100).regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/);
const contentShape = {
  schemaVersion: z.literal(1), principalId: id, provenance: z.enum(["LIVE", "DEVELOPMENT_FIXTURE"]),
  version: revision, party: PrincipalPartySchema,
  declaredActivityKeys: z.array(activity).min(1).max(50).refine(values => new Set(values).size === values.length),
  marketCountryCodes: z.array(CountryCodeSchema).min(1).max(50).refine(values => new Set(values).size === values.length),
};

// Declarations only: LIVE/ACTIVE labels never establish genuine authority.
// Original words and declared array order remain part of the exact hash input.
export const PrincipalVersionContentSchema = z.object(contentShape).strict();
export const PrincipalVersionSchema = z.object({ ...contentShape, id, sourceHash: hash, createdAt: instant }).strict()
  .refine(value => {
    // Recoverable size/shape issues can continue into Zod refinements. Only
    // fully validated bounded content may enter the canonical hash codec.
    const content = PrincipalVersionContentSchema.safeParse({ schemaVersion: value.schemaVersion,
      principalId: value.principalId, provenance: value.provenance, version: value.version,
      party: value.party, declaredActivityKeys: value.declaredActivityKeys, marketCountryCodes: value.marketCountryCodes });
    return content.success && value.sourceHash === canonicalHash(content.data);
  },
  "Principal declaration hash mismatch");
export const PrincipalStateSchema = z.object({ principalId: id, revision,
  state: z.enum(["DRAFT", "ACTIVE", "PAUSED", "REVOKED"]),
  currentVersion: z.object({ id, version: revision, sourceHash: hash }).strict().nullable(),
  createdAt: instant, updatedAt: instant }).strict()
  .refine(value => Date.parse(value.updatedAt) >= Date.parse(value.createdAt)
    && (value.state === "REVOKED" || (value.state === "DRAFT" ? value.currentVersion === null : value.currentVersion !== null)),
  "Principal state pointer or timestamp mismatch");

export type PrincipalVersionContent = z.infer<typeof PrincipalVersionContentSchema>;
export type PrincipalVersion = z.infer<typeof PrincipalVersionSchema>;
export type PrincipalState = z.infer<typeof PrincipalStateSchema>;
