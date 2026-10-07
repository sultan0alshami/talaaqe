import { z } from "zod";
import { UtcDateTimeSchema, resolveLocalDateTime } from "@/lib/contracts/vocabulary";

const DAY = 86400000;
const dateSchema = z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/).refine(value => {
  if (value.startsWith("0000-")) return false;
  const parsed = new Date(value + "T00:00:00.000Z");
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
});
export const BusinessCalendarSnapshotSchema = z.object({ schemaVersion: z.literal(1),
  id: z.string().min(1).max(200).regex(/^[\x21-\x7e]+$/), version: z.number().int().positive().max(2147483646),
  timeZone: z.literal("Asia/Riyadh"), workingWeek: z.tuple([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  validFrom: dateSchema, validThrough: dateSchema, holidays: z.array(dateSchema).max(3660),
  sourceReference: z.string().max(2000).refine(value => value.trim().length > 0), reviewedAt: UtcDateTimeSchema.refine(value => !value.startsWith("0000-")),
}).strict().superRefine((calendar, context) => {
  if (!dateSchema.safeParse(calendar.validFrom).success || !dateSchema.safeParse(calendar.validThrough).success
    || calendar.holidays.some(day => !dateSchema.safeParse(day).success)) return;
  const coverageDays = (Date.parse(calendar.validThrough + "T00:00:00.000Z") - Date.parse(calendar.validFrom + "T00:00:00.000Z")) / DAY + 1;
  if (coverageDays < 1 || coverageDays > 3660) context.addIssue({ code: "custom", message: "Calendar coverage must be1–3660 real local dates" });
  if (calendar.holidays.some((day, index) => day < calendar.validFrom || day > calendar.validThrough
    || index > 0 && day <= calendar.holidays[index - 1]!)) {
    context.addIssue({ code: "custom", message: "Holiday dates must be unique, ordered and covered" });
  }
});
export type BusinessCalendarSnapshot = z.infer<typeof BusinessCalendarSnapshotSchema>;

export type ReviewDeadline = { calendarId: string; calendarVersion: number; businessDate: string; dueAt: string };
export class BusinessCalendarError extends Error {
  constructor(public readonly code: "VALIDATION" | "CALENDAR_COVERAGE_REQUIRED" | "CAPABILITY_UNAVAILABLE", public readonly status = 422) {
    super(code); this.name = "BusinessCalendarError";
  }
}
export function calculateReviewDeadline(availableAt: string, calendar: unknown): ReviewDeadline {
  if (calendar === null || calendar === undefined) throw new BusinessCalendarError("CAPABILITY_UNAVAILABLE", 503);
  const input = BusinessCalendarSnapshotSchema.safeParse(calendar), instant = UtcDateTimeSchema.safeParse(availableAt);
  if (!input.success || !instant.success || instant.data.startsWith("0000-")) throw new BusinessCalendarError("VALIDATION");
  const snapshot = input.data;
  let parts: Record<string, string>;
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: snapshot.timeZone, calendar: "gregory", numberingSystem: "latn",
      year: "numeric", month: "2-digit", day: "2-digit" });
    parts = Object.fromEntries(formatter.formatToParts(new Date(instant.data)).map(part => [part.type, part.value]));
  } catch { throw new BusinessCalendarError("CAPABILITY_UNAVAILABLE", 503); }
  const localDate = `${parts.year!.padStart(4, "0")}-${parts.month}-${parts.day}`;
  if (!dateSchema.safeParse(localDate).success || localDate < snapshot.validFrom || localDate > snapshot.validThrough) {
    throw new BusinessCalendarError("CALENDAR_COVERAGE_REQUIRED", 503);
  }
  const holidays = new Set(snapshot.holidays), last = Date.parse(snapshot.validThrough + "T00:00:00.000Z");
  let remaining = 2;
  // These UTC dates are civil-date arithmetic only, never a timezone shortcut.
  // Resolve the chosen local EOD using the shared IANA/DST-aware resolver.
  for (let day = Date.parse(localDate + "T00:00:00.000Z") + DAY; day <= last; day += DAY) {
    const civil = new Date(day), businessDate = civil.toISOString().slice(0, 10);
    if (!snapshot.workingWeek.includes(civil.getUTCDay() as 0 | 1 | 2 | 3 | 4) || holidays.has(businessDate)) continue;
    if (--remaining !== 0) continue;
    let dueAt: string;
    try { dueAt = new Date(Date.parse(resolveLocalDateTime(businessDate + "T23:59:59", snapshot.timeZone)) + 999).toISOString(); }
    catch { throw new BusinessCalendarError("CAPABILITY_UNAVAILABLE", 503); }
    return { calendarId: snapshot.id, calendarVersion: snapshot.version, businessDate, dueAt };
  }
  throw new BusinessCalendarError("CALENDAR_COVERAGE_REQUIRED", 503);
}
