import { z } from "zod";
import { OfferDraftTermsSchema } from "@/lib/deals/drafts";

const id = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[\x21-\x7e]+$/);
export const ListSchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).optional(),
    cursor: id.optional(),
  })
  .strict();
export const DraftSchema = z
  .object({
    campaignId: id,
    creatorId: id,
    operationKey: z
      .string()
      .min(1)
      .max(120)
      .regex(/^[A-Za-z0-9_:-]+$/),
    expectedRevision: z.number().int().nonnegative(),
    patch: OfferDraftTermsSchema,
  })
  .strict();
export function listQuery(request: Request) {
  const params = new URL(request.url).searchParams;
  if ([...params.keys()].some((key) => params.getAll(key).length !== 1))
    throw new z.ZodError([
      { code: "custom", path: [], message: "Duplicate query parameter" },
    ]);
  return ListSchema.parse(Object.fromEntries(params));
}
