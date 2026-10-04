import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as vocabulary from "../src/lib/contracts/vocabulary";

const contracts = readFileSync(new URL("../docs/CONTRACTS.md", import.meta.url), "utf8");
const missingCanonicalNames = [
  "PublicationStatus", "ClaimStatus", "InterfaceLanguage", "BusinessVerificationStatus",
  "RepresentationStatus", "CreatorTier", "ImportJobStatus", "VoiceStatus",
  "GeneratedAssetStatus", "NotificationStatus", "AiPurpose",
] as const;

describe("canonical enum exports shared across domain workers", () => {
  it.each(missingCanonicalNames)("exports exactly the frozen %s contract", (name) => {
    const declaration = contracts.match(new RegExp(`type ${name} = ([\\s\\S]*?);`))?.[1];
    expect(declaration, `Missing frozen declaration for ${name}`).toBeDefined();
    const expectedValues = [...declaration!.matchAll(/'([^']+)'/g)].map((match) => match[1]);
    const schema = vocabulary[`${name}Schema` as keyof typeof vocabulary] as { options: string[]; safeParse(input: unknown): { success: boolean } } | undefined;
    expect(schema, `Missing runtime ${name}Schema`).toBeDefined();
    expect(schema!.options).toEqual(expectedValues);
    for (const value of expectedValues) expect(schema!.safeParse(value).success).toBe(true);
    for (const invalid of ["__UNKNOWN__", null, 1, {}]) expect(schema!.safeParse(invalid).success).toBe(false);
  });

  it("distinguishes the database profile state from publication and field visibility", () => {
    const publication = vocabulary["PublicationStatusSchema" as keyof typeof vocabulary] as { safeParse(input: unknown): { success: boolean } };
    expect(vocabulary.ProfileStateSchema.safeParse("PRIVATE").success).toBe(true);
    expect(publication.safeParse("PRIVATE").success).toBe(false);
    expect(vocabulary.VisibilitySchema.safeParse("PUBLIC").success).toBe(true);
    expect(vocabulary.ProfileStateSchema.safeParse("PUBLIC").success).toBe(false);
    expect(publication.safeParse("PUBLIC").success).toBe(false);
  });
});
