import { describe, expect, it } from "vitest";
import {
  MoneySchema, MAX_MINOR_UNITS, currencyPrecision, parseMoney,
  formatMoneyDecimal, allocateMoney, allocateIntegerTarget, addMoney, multiplyMoney,
} from "../src/lib/contracts/money";

describe("exact campaign money", () => {
  it("parses ISO minor precision without floating point rounding", () => {
    expect(parseMoney("0.29", "SAR")).toEqual({ amountMinor: "29", currencyCode: "SAR" });
    expect(parseMoney("123", "JPY").amountMinor).toBe("123");
    expect(parseMoney("1.234", "KWD").amountMinor).toBe("1234");
    expect(formatMoneyDecimal({ amountMinor: "1", currencyCode: "KWD" })).toBe("0.001");
    expect(currencyPrecision("MGA")).toBe(2); // official ISO units, not historic folklore
    expect(currencyPrecision("XCG")).toBe(2);
  });

  it.each(["1.001", "1e3", "-1", "+1", "1,000", "NaN", "1.", ".1"])("rejects ambiguous SAR input %s", (value) => {
    expect(() => parseMoney(value, "SAR")).toThrow();
  });

  it("rejects excess JPY/KWD precision, current-list exclusions and arbitrary codes", () => {
    expect(() => parseMoney("1.0", "JPY")).toThrow();
    expect(() => parseMoney("1.0001", "KWD")).toThrow();
    for (const currencyCode of ["ZZZ", "XXX", "XAU", "BGN", "CLF", "sar"]) {
      expect(MoneySchema.safeParse({ amountMinor: "100", currencyCode }).success).toBe(false);
    }
  });

  it("enforces canonical JSON integer strings and PostgreSQL range", () => {
    for (const amountMinor of [100, "01", "-1", "+1", "1.0", "1e3", "", "9".repeat(10000)]) {
      expect(MoneySchema.safeParse({ amountMinor, currencyCode: "SAR" }).success).toBe(false);
    }
    expect(MoneySchema.parse({ amountMinor: MAX_MINOR_UNITS.toString(), currencyCode: "SAR" }).amountMinor).toBe(MAX_MINOR_UNITS.toString());
    expect(() => multiplyMoney({ amountMinor: MAX_MINOR_UNITS.toString(), currencyCode: "SAR" }, 2)).toThrow();
    expect(() => addMoney({ amountMinor: "1", currencyCode: "SAR" }, { amountMinor: "1", currencyCode: "USD" })).toThrow();
  });

  it("allocates by stable slot ordinal and preserves exact remainders", () => {
    const slots = allocateMoney({ amountMinor: "100", currencyCode: "JPY" }, 3);
    expect(slots.map((slot) => slot.amountMinor)).toEqual(["34", "33", "33"]);
    expect(slots.reduce((total, slot) => total + BigInt(slot.amountMinor), BigInt(0))).toBe(BigInt(100));
    expect(allocateIntegerTarget(10, 3)).toEqual([4, 3, 3]);
    expect(allocateMoney({ amountMinor: "2", currencyCode: "SAR" }, 4).map((slot) => slot.amountMinor)).toEqual(["1", "1", "0", "0"]);
    expect(() => allocateMoney({ amountMinor: "100", currencyCode: "SAR" }, 0)).toThrow();
    expect(() => allocateIntegerTarget(10, 13)).toThrow();
  });
});
