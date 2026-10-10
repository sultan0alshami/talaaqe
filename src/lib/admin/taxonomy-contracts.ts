import { z } from "zod";
import { FameIndustrySchema, UtcDateTimeSchema } from "@/lib/contracts/vocabulary";
import { FAME_RELATED_NICHES, NICHE_SOURCE, NICHE_TAXONOMY } from "@/lib/contracts/taxonomy";

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const niche = z.object({ slug: z.string(), parentSlug: z.string().nullable(), labelAr: z.string(),
  labelEn: z.string(), sortOrder: z.number().int().nonnegative(), assignmentCount: count }).strict();
const fame = z.object({ industry: FameIndustrySchema, relatedNicheSlugs: z.array(z.string()), assignmentCount: count }).strict();
export const AdminTaxonomySchema = z.object({
  asOf: UtcDateTimeSchema, scope: z.literal("ALL_STORED_CREATOR_ASSIGNMENTS"),
  source: z.object({ reference: z.literal(NICHE_SOURCE.reference), checkedAt: z.literal(NICHE_SOURCE.checkedAt),
    sha256: z.literal(NICHE_SOURCE.sha256), version: z.literal(NICHE_SOURCE.version) }).strict(),
  niches: z.array(niche).length(NICHE_TAXONOMY.length),
  fame: z.array(fame).length(FameIndustrySchema.options.length),
  unknownAssignments: z.object({ nicheCreators: count, fameCreators: count }).strict(),
}).strict().refine(value => value.niches.every((row, index) => {
  const expected = NICHE_TAXONOMY[index];
  return expected && row.slug === expected.slug && row.parentSlug === expected.parentSlug
    && row.labelAr === expected.labelAr && row.labelEn === expected.labelEn && row.sortOrder === expected.sortOrder;
}) && value.fame.every((row, index) => row.industry === FameIndustrySchema.options[index]
  && JSON.stringify(row.relatedNicheSlugs) === JSON.stringify(FAME_RELATED_NICHES[row.industry])));
export type AdminTaxonomyDTO = z.infer<typeof AdminTaxonomySchema>;
