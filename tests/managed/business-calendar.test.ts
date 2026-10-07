import { describe, expect, it, vi } from "vitest";
import {
  BusinessCalendarError,
  calculateReviewDeadline,
} from "../../src/lib/managed/business-calendar";

// Synthetic local snapshots exercise calendar arithmetic, never live holiday
// accuracy, genuine review provenance, or permission to approve/publish an item.
type CalendarFixture = {
  schemaVersion: number;
  id: string;
  version: number;
  timeZone: string;
  workingWeek: number[];
  validFrom: string;
  validThrough: string;
  holidays: string[];
  sourceReference: string;
  reviewedAt: string;
};

function calendar(overrides: Partial<CalendarFixture> = {}): CalendarFixture {
  return {
    schemaVersion: 1,
    id: "synthetic-calendar-2026",
    version: 7,
    timeZone: "Asia/Riyadh",
    workingWeek: [0, 1, 2, 3, 4],
    validFrom: "2026-01-01",
    validThrough: "2026-12-31",
    holidays: [],
    sourceReference: "Synthetic snapshot for deterministic local tests only",
    reviewedAt: "2025-12-15T09:00:00.000Z",
    ...overrides,
  };
}

function expectWeekday(localDate: string, weekday: number): void {
  // Independent fixture sanity check: UTC noon has the same Gregorian date
  // without relying on the machine timezone or the production calendar helper.
  const date = new Date(`${localDate}T12:00:00.000Z`);
  expect(date.toISOString().slice(0, 10)).toBe(localDate);
  expect(date.getUTCDay()).toBe(weekday);
}

function expectCalendarError(
  availableAt: string,
  snapshot: unknown,
  code: "VALIDATION" | "CALENDAR_COVERAGE_REQUIRED" | "CAPABILITY_UNAVAILABLE",
  status: 422 | 503,
): void {
  let caught: unknown;
  try {
    calculateReviewDeadline(availableAt, snapshot);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(BusinessCalendarError);
  expect(caught).toMatchObject({ code, status });
}

describe("managed review business calendar", () => {
  it("starts strictly after the Riyadh availability date across the UTC midnight boundary", () => {
    expectWeekday("2026-10-03", 6);
    expectWeekday("2026-10-04", 0);
    expectWeekday("2026-10-05", 1);
    expectWeekday("2026-10-06", 2);

    const snapshot = calendar();
    for (const [availableAt, businessDate, dueAt] of [
      // Saturday 23:59:59.999 local: Sunday and Monday are the two days.
      ["2026-10-03T20:59:59.999Z", "2026-10-05", "2026-10-05T20:59:59.999Z"],
      // Sunday 00:00 local: Sunday itself cannot count toward the review days.
      ["2026-10-03T21:00:00.000Z", "2026-10-06", "2026-10-06T20:59:59.999Z"],
      // Existing canonical UTC input also permits whole seconds.
      ["2026-10-04T12:00:00Z", "2026-10-06", "2026-10-06T20:59:59.999Z"],
    ]) {
      expect(calculateReviewDeadline(availableAt, snapshot)).toEqual({
        calendarId: snapshot.id,
        calendarVersion: 7,
        businessDate,
        dueAt,
      });
    }
  });

  it("skips Friday/Saturday once and consecutive explicit holidays without inventing others", () => {
    expectWeekday("2026-10-09", 5);
    expectWeekday("2026-10-10", 6);
    expectWeekday("2026-10-11", 0);
    expectWeekday("2026-10-12", 1);
    expectWeekday("2026-10-14", 3);

    const availableAt = "2026-10-09T09:00:00.000Z";
    expect(calculateReviewDeadline(availableAt, calendar())).toEqual({
      calendarId: "synthetic-calendar-2026",
      calendarVersion: 7,
      businessDate: "2026-10-12",
      dueAt: "2026-10-12T20:59:59.999Z",
    });
    expect(calculateReviewDeadline(availableAt, calendar({
      holidays: ["2026-10-09", "2026-10-10", "2026-10-11", "2026-10-12"],
    }))).toEqual({
      calendarId: "synthetic-calendar-2026",
      calendarVersion: 7,
      businessDate: "2026-10-14",
      dueAt: "2026-10-14T20:59:59.999Z",
    });
  });

  it("returns the exact last local millisecond through year rollover and a real leap-day holiday", () => {
    expectWeekday("2026-12-31", 4);
    expectWeekday("2027-01-04", 1);
    expectWeekday("2028-02-27", 0);
    expectWeekday("2028-03-01", 3);

    const cases = [
      {
        availableAt: "2026-12-31T18:00:00.000Z",
        snapshot: calendar({ validFrom: "2026-12-01", validThrough: "2027-01-31" }),
        businessDate: "2027-01-04",
        dueAt: "2027-01-04T20:59:59.999Z",
      },
      {
        // Monday is day one, leap-day Tuesday is a supplied holiday, Wednesday is day two.
        availableAt: "2028-02-27T08:00:00.000Z",
        snapshot: calendar({
          validFrom: "2028-02-01",
          validThrough: "2028-03-31",
          holidays: ["2028-02-29"],
        }),
        businessDate: "2028-03-01",
        dueAt: "2028-03-01T20:59:59.999Z",
      },
    ];
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Riyadh",
      calendar: "gregory",
      numberingSystem: "latn",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    for (const fixture of cases) {
      const result = calculateReviewDeadline(fixture.availableAt, fixture.snapshot);
      expect(result).toEqual({
        calendarId: fixture.snapshot.id,
        calendarVersion: fixture.snapshot.version,
        businessDate: fixture.businessDate,
        dueAt: fixture.dueAt,
      });
      const instant = new Date(result.dueAt);
      const parts = Object.fromEntries(formatter.formatToParts(instant).map((part) => [part.type, part.value]));
      expect(`${parts.year}-${parts.month}-${parts.day}`).toBe(fixture.businessDate);
      expect([parts.hour, parts.minute, parts.second, instant.getUTCMilliseconds()]).toEqual(["23", "59", "59", 999]);
    }
  });

  it("requires an available snapshot and coverage for the starting date and both future working days", () => {
    const availableAt = "2026-10-04T09:00:00.000Z";
    for (const missing of [null, undefined]) {
      expectCalendarError(availableAt, missing, "CAPABILITY_UNAVAILABLE", 503);
    }
    for (const [instant, snapshot] of [
      // The starting local date is outside the snapshot even though the later cutoff could fit.
      ["2026-10-03T20:59:59.999Z", calendar({ validFrom: "2026-10-04", validThrough: "2026-10-06" })],
      ["2026-10-06T21:00:00.000Z", calendar({ validFrom: "2026-10-04", validThrough: "2026-10-06" })],
      // Exactly one eligible future day remains; extending coverage is not implicit.
      [availableAt, calendar({ validFrom: "2026-10-04", validThrough: "2026-10-05" })],
      [availableAt, calendar({ validFrom: "2026-10-04", validThrough: "2026-10-06", holidays: ["2026-10-05"] })],
    ] as const) {
      expectCalendarError(instant, snapshot, "CALENDAR_COVERAGE_REQUIRED", 503);
    }
    expect(calculateReviewDeadline(availableAt, calendar({
      validFrom: "2026-10-04",
      validThrough: "2026-10-06",
    })).dueAt).toBe("2026-10-06T20:59:59.999Z");

    // Synthetic runtime failure exercises the unavailable path; it is not live ICU evidence.
    const unavailableFormatter = vi.spyOn(Intl, "DateTimeFormat").mockImplementation(function syntheticUnavailableFormatter() {
      throw new RangeError("Synthetic Intl.DateTimeFormat unavailable");
    });
    try {
      expectCalendarError(availableAt, calendar(), "CAPABILITY_UNAVAILABLE", 503);
    } finally {
      unavailableFormatter.mockRestore();
    }
  });

  it("rejects malformed calendars and noncanonical or impossible UTC instants instead of repairing them", () => {
    const availableAt = "2026-10-04T09:00:00.000Z";
    const invalidSnapshots: unknown[] = [
      [],
      {},
      calendar({ schemaVersion: 2 }),
      calendar({ id: "" }),
      calendar({ id: "x".repeat(201) }),
      calendar({ id: "تقويم" }),
      calendar({ version: 0 }),
      calendar({ version: 1.5 }),
      calendar({ version: 2147483647 }),
      calendar({ timeZone: "UTC" }),
      calendar({ workingWeek: [1, 2, 3, 4, 0] }),
      calendar({ workingWeek: [0, 1, 2, 3, 4, 5] }),
      calendar({ validFrom: "2026-02-30" }),
      calendar({ validThrough: "2027-02-29" }),
      calendar({ validFrom: "0000-01-01" }),
      calendar({ validFrom: "2026-12-31", validThrough: "2026-01-01" }),
      calendar({ validFrom: "2020-01-01", validThrough: "2031-01-01" }),
      calendar({ holidays: ["2026-10-05", "2026-10-05"] }),
      calendar({ holidays: ["2026-10-06", "2026-10-05"] }),
      calendar({ holidays: ["2026-02-30"] }),
      calendar({ holidays: ["2027-01-01"] }),
      calendar({ sourceReference: " \n\t " }),
      calendar({ sourceReference: "x".repeat(2001) }),
      calendar({ reviewedAt: "0000-01-01T09:00:00.000Z" }),
      calendar({ reviewedAt: "2026-02-30T09:00:00.000Z" }),
      calendar({ reviewedAt: "2026-01-01T12:00:00+03:00" }),
      { ...calendar(), approved: true },
    ];
    for (const snapshot of invalidSnapshots) {
      expectCalendarError(availableAt, snapshot, "VALIDATION", 422);
    }
    for (const instant of [
      "",
      "2026-02-30T09:00:00.000Z",
      "2026-10-04T09:00:00.1Z",
      "2026-10-04T12:00:00+03:00",
      "2026-10-04T09:00:00",
      "0000-10-04T09:00:00.000Z",
    ]) {
      expectCalendarError(instant, calendar(), "VALIDATION", 422);
    }
  });

  it("preserves caller snapshots and pins each result to its supplied immutable calendar version", () => {
    const availableAt = "2026-10-04T09:00:00.000Z";
    const original = calendar({ sourceReference: "  Synthetic local test reference retained verbatim  " });
    const before = JSON.stringify(original);
    Object.freeze(original.workingWeek);
    Object.freeze(original.holidays);
    Object.freeze(original);

    const originalResult = calculateReviewDeadline(availableAt, original);
    const updated = calendar({ id: original.id, version: 8, holidays: ["2026-10-06"] });
    const updatedBefore = JSON.stringify(updated);
    expect(calculateReviewDeadline(availableAt, updated)).toEqual({
      calendarId: original.id,
      calendarVersion: 8,
      businessDate: "2026-10-07",
      dueAt: "2026-10-07T20:59:59.999Z",
    });
    expect(originalResult).toEqual({
      calendarId: original.id,
      calendarVersion: 7,
      businessDate: "2026-10-06",
      dueAt: "2026-10-06T20:59:59.999Z",
    });
    expect(JSON.stringify(original)).toBe(before);
    expect(JSON.stringify(updated)).toBe(updatedBefore);
  });
});
