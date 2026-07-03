import { MatchStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AnalyticsScreen } from "@/components/screens/admin/analytics-screen";

// Admin matching analytics — mirrors GET /api/admin/analytics.
export default async function AdminAnalyticsPage() {
  const matches = await prisma.match.findMany({ select: { matchScore: true, status: true } });

  const avg = matches.length
    ? Math.round(matches.reduce((s, m) => s + m.matchScore, 0) / matches.length)
    : 0;
  const responded = matches.filter((m) =>
    (
      [MatchStatus.ACCEPTED, MatchStatus.DECLINED, MatchStatus.PROPOSAL_REQUESTED, MatchStatus.PROPOSAL_SENT] as MatchStatus[]
    ).includes(m.status)
  );
  const positive = responded.filter((m) => m.status !== MatchStatus.DECLINED);
  const accept = responded.length ? Math.round((positive.length / responded.length) * 100) : 0;

  const dist = [
    { min: 90, max: 100, labelAr: "90 – 100", labelEn: "90 – 100" },
    { min: 80, max: 89, labelAr: "80 – 89", labelEn: "80 – 89" },
    { min: 70, max: 79, labelAr: "70 – 79", labelEn: "70 – 79" },
    { min: 0, max: 69, labelAr: "أقل من 70", labelEn: "Below 70" },
  ].map((b) => ({
    rAr: b.labelAr,
    rEn: b.labelEn,
    v: matches.filter((m) => m.matchScore >= b.min && m.matchScore <= b.max).length,
  }));

  // Projects created per weekday of the current week (Sun-first, KSA convention).
  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - now.getDay());
  weekStart.setHours(0, 0, 0, 0);
  const weekProjects = await prisma.project.findMany({
    where: { createdAt: { gte: weekStart } },
    select: { createdAt: true },
  });
  const weekly = Array.from({ length: 7 }, (_, i) => weekProjects.filter((p) => p.createdAt.getDay() === i).length);

  return (
    <AnalyticsScreen
      avg={avg}
      accept={accept}
      timeAr="3.2 دقيقة"
      timeEn="3.2 min"
      dist={dist}
      weekly={weekly}
      // Subscription revenue is out of MVP scope — placeholders per the API shape.
      rev={{ mrr: "48,500", subs: "214", growth: "+18%" }}
    />
  );
}
