import { z } from "zod";

// Exact inherited profile text and approved fact-template contract. Original
// bio and section text are deliberately untrimmed; interface locale is separate.
export const ProfileTextSchema = z.string().trim().min(1).max(500).regex(/^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+$/);
export const PortfolioContentSchema = z.object({
  title: ProfileTextSchema.max(200),
  bio: z.string().max(1000),
  sections: z.array(z.object({ heading: ProfileTextSchema.max(100), text: z.string().max(2000) }).strict()).max(20),
  method: z.literal("APPROVED_FACT_TEMPLATE"),
}).strict();
export type PortfolioContent = z.infer<typeof PortfolioContentSchema>;
