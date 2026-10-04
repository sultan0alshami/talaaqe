import { describe, expect, it } from "vitest";
import { calculateFit } from "@/lib/matching/strategy";
import { allocateMoney } from "@/lib/contracts/money";

// Independent specification oracle: integer percentages and rational rounding.
// No production weights, decimal conversion or score helper supplies expectations.
describe("independent fit and exact allocation review", () => {
  it("matches 600 rational cases across three confidence tiers and neutral unknowns", () => {
    for (let sample = 0; sample < 600; sample++) {
      const p = Array.from({ length: 7 }, (_, index) => (sample * 19 + index * 17 + 13) % 101);
      const confidence = [40, 70, 100][sample % 3];
      const unknown = sample % 17 === 0 ? sample % 7 : -1;
      const normalized = p.map((value, index) => index === unknown ? 50 : value);
      const numerator = normalized.reduce((total, value, index) => total + value * [25, 20, 15, 10, 10, 10, 10][index], 0) * (100 + confidence);
      const expected = Math.floor((numerator + 10_000) / 20_000);
      const actual = calculateFit({ age: unknown === 0 ? null : p[0] / 100, niche: unknown === 1 ? null : p[1] / 100, geography: unknown === 2 ? null : p[2] / 100,
        gender: unknown === 3 ? null : p[3] / 100, engagement: unknown === 4 ? null : p[4] / 100, budget: unknown === 5 ? null : p[5] / 100, exposure: unknown === 6 ? null : p[6] / 100 }, confidence / 100);
      expect(actual.score, `rational sample ${sample}`).toBe(expected);
    }
  });
  it("conserves four large integer budgets across every supported creator count", () => {
    for (const budget of ["9007199254740993", "9223372036854775807", "9007199254741001", "99999999999999999"]) {
      for (let count = 1; count <= 12; count++) {
        const rows = allocateMoney({ amountMinor: budget, currencyCode: "KWD" }, count);
        const units = rows.map((r) => BigInt(r.amountMinor));
        expect(units.reduce((sum, value) => sum + value, BigInt(0))).toBe(BigInt(budget));
        expect(units.every((value, index) => value === BigInt(budget) / BigInt(count) + (BigInt(index) < BigInt(budget) % BigInt(count) ? BigInt(1) : BigInt(0)))).toBe(true);
      }
    }
  });
});
