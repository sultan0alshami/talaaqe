// Formatting helpers. Numbers stay Western Arabic numerals (README §11).
import type { Lang } from "./i18n";

export function fmtNum(n: number): string {
  return n.toLocaleString("en-US");
}

/** "4,000–8,000" or "—" when unknown. */
export function fmtBudget(min: number | null | undefined, max: number | null | undefined): string {
  if (min == null || max == null) return "—";
  return `${fmtNum(min)}–${fmtNum(max)}`;
}

/** "2026/06/28" style used across tables in the prototype. */
export function fmtDate(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${y}/${m}/${day}`;
}

/** Activity/relative time: "اليوم 10:24 ص" / "Today 10:24 AM" / "أمس" / date. */
export function fmtWhen(d: Date | string, lang: Lang): string {
  const date = typeof d === "string" ? new Date(d) : d;
  const now = new Date();
  const isAr = lang === "ar";
  const sameDay = date.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();

  let h = date.getHours();
  const mm = String(date.getMinutes()).padStart(2, "0");
  const pm = h >= 12;
  h = h % 12 || 12;
  const time = `${h}:${mm} ${isAr ? (pm ? "م" : "ص") : pm ? "PM" : "AM"}`;

  if (sameDay) return isAr ? `اليوم ${time}` : `Today ${time}`;
  if (isYesterday) return isAr ? `أمس ${time}` : `Yesterday ${time}`;
  return fmtDate(date);
}

/** "قبل 10 دقائق" / "10 minutes ago" style for provider request cards. */
export function fmtAgo(d: Date | string, lang: Lang): string {
  const date = typeof d === "string" ? new Date(d) : d;
  const mins = Math.max(1, Math.round((Date.now() - date.getTime()) / 60_000));
  const isAr = lang === "ar";
  if (mins < 60) return isAr ? `قبل ${mins} دقيقة` : `${mins} minutes ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return isAr ? `قبل ${hours} ساعات` : `${hours} hours ago`;
  if (hours < 48) return isAr ? "أمس" : "Yesterday";
  return fmtDate(date);
}
