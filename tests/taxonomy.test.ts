import { describe, expect, it } from "vitest";
import { FameIndustrySchema } from "../src/lib/contracts/vocabulary";
import { FAME_RELATED_NICHES, NICHE_BY_SLUG, NICHE_TAXONOMY } from "../src/lib/contracts/taxonomy";

describe("curated shared Infame taxonomy", () => {
  it("retains139 unique stable slugs with30 roots and109 parented children", () => {
    expect(NICHE_TAXONOMY).toHaveLength(139);
    expect(new Set(NICHE_TAXONOMY.map((row) => row.slug)).size).toBe(139);
    expect(NICHE_TAXONOMY.filter((row) => row.parentSlug === null)).toHaveLength(30);
    expect(NICHE_TAXONOMY.filter((row) => row.parentSlug !== null)).toHaveLength(109);
    expect(Object.keys(NICHE_BY_SLUG)).toHaveLength(139);
    for (const row of NICHE_TAXONOMY) {
      expect(row.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(row.labelAr.trim()).not.toBe(""); expect(row.labelEn.trim()).not.toBe("");
      expect(NICHE_BY_SLUG[row.slug]).toBe(row);
    }
  });
  it("has no dangling parent, self-parent, cycle or invented database-ID relationship", () => {
    for (const row of NICHE_TAXONOMY) {
      if (row.parentSlug !== null) {
        expect(row.parentSlug).not.toBe(row.slug);
        expect(NICHE_BY_SLUG[row.parentSlug]?.parentSlug).toBeNull();
      }
    }
    expect(NICHE_BY_SLUG.skincare.parentSlug).toBe("beauty");
    expect(NICHE_BY_SLUG.makeup.parentSlug).toBe("beauty");
    expect(NICHE_BY_SLUG.makeup.parentSlug).not.toBe(NICHE_BY_SLUG.gadgets.parentSlug);
    expect(NICHE_BY_SLUG["home-cooking"].parentSlug).toBe("food");
  });
  it("preserves original bilingual labels and flattened source order", () => {
    expect(NICHE_BY_SLUG.beauty).toMatchObject({labelAr:"جمال وعناية",labelEn:"Beauty & Skincare",sortOrder:0});
    expect(NICHE_BY_SLUG.skincare).toMatchObject({labelAr:"العناية بالبشرة",labelEn:"Skincare",sortOrder:1});
    expect(NICHE_BY_SLUG.coffee).toMatchObject({labelAr:"قهوة مختصة",labelEn:"Specialty coffee"});
    expect(NICHE_BY_SLUG["daily-adhkar"]).toMatchObject({labelAr:"أذكار",labelEn:"Daily adhkar"});
    expect(NICHE_TAXONOMY.map((row)=>row.sortOrder)).toEqual(Array.from({length:139},(_,ordinal)=>ordinal));
  });
  it("uses exactly the canonical fame vocabulary and only existing related niche slugs", () => {
    expect(Object.keys(FAME_RELATED_NICHES).sort()).toEqual([...FameIndustrySchema.options].sort());
    expect(FAME_RELATED_NICHES["social-only"]).toEqual([]);
    expect(Object.hasOwn(FAME_RELATED_NICHES,"social_only")).toBe(false);
    expect(FAME_RELATED_NICHES.fashion).toEqual(["fashion","beauty"]);
    expect(FAME_RELATED_NICHES.cooking).toEqual(["food"]);
    expect(FAME_RELATED_NICHES.academia).toEqual(["education","books"]);
    for (const rows of Object.values(FAME_RELATED_NICHES)) for (const slug of rows) expect(NICHE_BY_SLUG[slug]).toBeDefined();
  });
  it("keeps the central catalog/map/fame lists immutable", () => {
    expect(Object.isFrozen(NICHE_TAXONOMY)).toBe(true);
    expect(Object.isFrozen(NICHE_BY_SLUG)).toBe(true);
    expect(Object.isFrozen(FAME_RELATED_NICHES)).toBe(true);
    expect(NICHE_TAXONOMY.every(Object.isFrozen)).toBe(true);
    expect(Object.values(FAME_RELATED_NICHES).every(Object.isFrozen)).toBe(true);
  });
});
