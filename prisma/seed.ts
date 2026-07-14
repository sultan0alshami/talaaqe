/* eslint-disable no-console */
// Seed: ports design_handoff_talaqi_backend/talaqi-data.js into the database (README §12).
// Demo login: ahmed@oudalkhaleej.sa / abdullah.dev@gmail.com / ops@talaqi.sa — password "talaqi123".
import { PrismaClient, Role, ProviderType, ProjectStatus, MatchStatus, Complexity, VerifiedStatus, Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import {
  CATEGORIES,
  PROVIDERS,
  MATCHES,
  PROJECTS,
  OPPORTUNITIES,
  ADMIN,
  CHAT_SCRIPT,
  CHAT_DONE,
  BRIEF,
  USERS,
  REQUESTS,
  SKILLS,
  I18N,
} from "../src/lib/talaqi-data";
import { scoreProvider, type MatchableBrief, type MatchableProvider } from "../src/lib/matching";

const prisma = new PrismaClient();
export const DEMO_PASSWORD = "talaqi123";

const d = (s: string) => new Date(s.replace(/\//g, "-") + "T09:00:00+03:00");
const minAgo = (m: number) => new Date(Date.now() - m * 60_000);

const TYPE_MAP: Record<string, ProviderType> = {
  Freelancer: ProviderType.FREELANCER,
  Agency: ProviderType.AGENCY,
  Company: ProviderType.COMPANY,
  Consultant: ProviderType.CONSULTANT,
};
const AVAIL_MAP: Record<string, string> = {
  "Available now": "now",
  "Available in 1 week": "1_week",
  "Available in 2 weeks": "2_weeks",
  "Available in 1 month": "1_month",
};
// Primary categories per provider (1-based CATEGORIES ids), mirroring each role description.
const PROVIDER_CATS: Record<number, number[]> = {
  1: [2], 2: [2, 7], 3: [2], 4: [4], 5: [1, 2], 6: [10], 7: [4], 8: [7, 8],
  9: [9], 10: [6], 11: [11], 12: [3], 13: [12], 14: [15], 15: [8], 16: [14],
};
const PROVIDER_EMAILS: Record<number, string> = {
  1: "abdullah.dev@gmail.com",
  2: "hello@nuqta.sa",
  3: "mohammed.otaibi@talaqi.sa",
  4: "studio@pixelarabia.sa",
  5: "info@tiqnia.sa",
  6: "reem.photo@gmail.com",
  7: "sarah.design@outlook.com",
  8: "hello@ruaa.sa",
  9: "noura.content@talaqi.sa",
  10: "hello@lamsatibdaa.sa",
  11: "fahad.harbi@talaqi.sa",
  12: "info@miamar.ae",
  13: "khalid.bawazeer@talaqi.sa",
  14: "info@datalens.sa",
  15: "hind.social@talaqi.sa",
  16: "info@amancyber.sa",
};
const PROVIDER_JOINED: Record<number, string> = {
  1: "2025/11/02", 2: "2025/10/05", 6: "2026/01/30", 7: "2025/12/18",
};

async function main() {
  console.log("Clearing existing data…");
  await prisma.$transaction([
    prisma.aiUsageLog.deleteMany(),
    prisma.activityLog.deleteMany(),
    prisma.match.deleteMany(),
    prisma.conversation.deleteMany(),
    prisma.brief.deleteMany(),
    prisma.project.deleteMany(),
    prisma.providerSkill.deleteMany(),
    prisma.providerCategory.deleteMany(),
    prisma.portfolioItem.deleteMany(),
    prisma.skill.deleteMany(),
    prisma.category.deleteMany(),
    prisma.provider.deleteMany(),
    prisma.client.deleteMany(),
    prisma.user.deleteMany(),
  ]);

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  // ── Categories ────────────────────────────────────────────────────
  console.log("Seeding categories…");
  const catByDataId = new Map<number, string>();
  for (const c of CATEGORIES) {
    const row = await prisma.category.create({
      data: { nameAr: c.ar, nameEn: c.en, demoCount: c.count, sortOrder: c.id },
    });
    catByDataId.set(c.id, row.id);
  }
  const catIdByEn = new Map<string, string>();
  for (const c of CATEGORIES) catIdByEn.set(c.en, catByDataId.get(c.id)!);

  // ── Skills (canonical list + created on demand) ───────────────────
  console.log("Seeding skills…");
  const skillIds = new Map<string, string>();
  const findCatForSkill = (cEn: string) => {
    const hit = CATEGORIES.find((c) => c.en.toLowerCase().includes(cEn.toLowerCase()));
    return catByDataId.get(hit?.id ?? 1)!;
  };
  for (const s of SKILLS) {
    const row = await prisma.skill.create({ data: { name: s.n, categoryId: findCatForSkill(s.cEn) } });
    skillIds.set(s.n, row.id);
  }
  const ensureSkill = async (name: string, categoryId: string) => {
    if (skillIds.has(name)) return skillIds.get(name)!;
    const row = await prisma.skill.create({ data: { name, categoryId } });
    skillIds.set(name, row.id);
    return row.id;
  };

  // ── Providers (16) + their user accounts ──────────────────────────
  console.log("Seeding providers…");
  const providerByDataId = new Map<number, string>();
  for (const p of PROVIDERS) {
    const cats = PROVIDER_CATS[p.id].map((cid) => catByDataId.get(cid)!);
    const isOrg = p.typeEn !== "Freelancer";
    const user = await prisma.user.create({
      data: {
        name: p.ar,
        nameEn: p.en,
        email: PROVIDER_EMAILS[p.id],
        passwordHash,
        role: Role.PROVIDER,
        companyName: isOrg ? p.en : null,
        createdAt: d(PROVIDER_JOINED[p.id] ?? "2026/01/15"),
      },
    });
    const provider = await prisma.provider.create({
      data: {
        userId: user.id,
        providerType: TYPE_MAP[p.typeEn],
        roleTitleAr: p.roleAr,
        roleTitleEn: p.roleEn,
        experienceYears: p.years,
        priceRangeMin: p.min,
        priceRangeMax: p.max,
        availability: AVAIL_MAP[p.availEn] ?? "now",
        rating: p.rating,
        verifiedStatus: p.verified ? VerifiedStatus.APPROVED : VerifiedStatus.PENDING,
        locationAr: p.cityAr,
        locationEn: p.cityEn,
        location: p.cityEn.toLowerCase(),
        languages: p.langs.toLowerCase().split(" / ").map((l) => l.trim()),
        avatarColor: p.color,
        avatarInitial: p.init,
      },
    });
    providerByDataId.set(p.id, provider.id);
    for (const catId of cats) {
      await prisma.providerCategory.create({ data: { providerId: provider.id, categoryId: catId } });
    }
    for (const s of p.skills) {
      const skillId = await ensureSkill(s, cats[0]);
      await prisma.providerSkill.create({ data: { providerId: provider.id, skillId } });
    }
  }
  // Abdullah's portfolio (I18N portfolioItems, AR/EN pairs)
  const abdullah = providerByDataId.get(1)!;
  for (let i = 0; i < I18N.ar.portfolioItems.length; i++) {
    await prisma.portfolioItem.create({
      data: { providerId: abdullah, title: I18N.ar.portfolioItems[i], titleEn: I18N.en.portfolioItems[i] },
    });
  }

  // ── Pending providers awaiting approval (ADMIN.pendingProviders) ──
  const PENDING_META: { type: ProviderType; email: string }[] = [
    { type: ProviderType.FREELANCER, email: "majed.subaie@talaqi.sa" },
    { type: ProviderType.AGENCY, email: "studio@dhaw.sa" },
    { type: ProviderType.FREELANCER, email: "areej.ghamdi@talaqi.sa" },
    { type: ProviderType.COMPANY, email: "info@numou.sa" },
  ];
  for (let i = 0; i < ADMIN.pendingProviders.length; i++) {
    const pp = ADMIN.pendingProviders[i];
    const [nameAr, roleAr] = pp.ar.split(" — ");
    const [nameEn, roleEn] = pp.en.split(" — ");
    const user = await prisma.user.create({
      data: {
        name: nameAr,
        nameEn,
        email: PENDING_META[i].email,
        passwordHash,
        role: Role.PROVIDER,
        createdAt: d(pp.d),
      },
    });
    await prisma.provider.create({
      data: {
        userId: user.id,
        providerType: PENDING_META[i].type,
        roleTitleAr: roleAr ?? nameAr,
        roleTitleEn: roleEn ?? nameEn,
        verifiedStatus: VerifiedStatus.PENDING,
        locationAr: pp.cityAr,
        locationEn: pp.cityEn,
        languages: ["ar"],
        avatarColor: "#1B3568",
        avatarInitial: nameAr.charAt(0),
        createdAt: d(pp.d),
      },
    });
  }

  // ── Clients + admin ───────────────────────────────────────────────
  console.log("Seeding clients + admin…");
  const mkClient = async (opts: {
    nameAr: string; nameEn: string; email: string; joined: string; active?: boolean;
    company?: string; phone?: string; organizationType?: string; sector?: string; location?: string;
  }) => {
    const user = await prisma.user.create({
      data: {
        name: opts.nameAr,
        nameEn: opts.nameEn,
        email: opts.email,
        phone: opts.phone,
        passwordHash,
        role: Role.CLIENT,
        companyName: opts.company,
        active: opts.active ?? true,
        createdAt: d(opts.joined),
      },
    });
    const client = await prisma.client.create({
      data: {
        userId: user.id,
        organizationType: opts.organizationType,
        sector: opts.sector,
        location: opts.location,
      },
    });
    return client.id;
  };

  const ahmed = await mkClient({
    nameAr: "أحمد المطيري", nameEn: "Ahmed Al-Mutairi", email: "ahmed@oudalkhaleej.sa",
    joined: "2026/03/14", company: "شركة عود الخليج", phone: "+966 55 123 4567",
    organizationType: "company", sector: "تجزئة — عطور ومستحضرات", location: "الرياض",
  });
  const muna = await mkClient({
    nameAr: "منى الراشد", nameEn: "Muna Al-Rashed", email: "muna@nooncafe.sa",
    joined: "2026/01/22", company: "مقهى نون", organizationType: "sme", location: "الرياض",
  });
  const badr = await mkClient({
    nameAr: "بدر الغامدي", nameEn: "Badr Al-Ghamdi", email: "badr@rswn.sa",
    joined: "2026/02/09", organizationType: "startup", location: "جدة",
  });
  const morningCup = await mkClient({
    nameAr: "مؤسسة كوب الصباح", nameEn: "Morning Cup Est.", email: "info@morningcup.sa",
    joined: "2026/04/11", company: "مؤسسة كوب الصباح", organizationType: "sme", location: "الرياض",
  });
  await mkClient({
    nameAr: "طارق حسن", nameEn: "Tariq Hassan", email: "tariq.h@yahoo.com",
    joined: "2026/05/03", active: false, organizationType: "individual", location: "الدمام",
  });
  const dar = await mkClient({
    nameAr: "دار الأناقة للأزياء", nameEn: "Dar Al-Anaqa Fashion", email: "info@daralanaqa.sa",
    joined: "2026/03/02", company: "دار الأناقة للأزياء", organizationType: "company", location: "جدة",
  });
  await prisma.user.create({
    data: {
      name: "فريق تلاقي", nameEn: "Talaqi Team", email: "ops@talaqi.sa",
      passwordHash, role: Role.ADMIN, createdAt: d("2025/09/01"),
    },
  });
  void USERS; // USERS table content is realized by the accounts above

  // ── Projects ─────────────────────────────────────────────────────
  console.log("Seeding projects…");
  const catId = (en: string) => {
    const hit = CATEGORIES.find((c) => c.en.toLowerCase().includes(en.toLowerCase()) || en.toLowerCase().includes(c.en.toLowerCase()));
    return hit ? catByDataId.get(hit.id)! : null;
  };
  const parseBudget = (b: string): [number | null, number | null] => {
    const m = b.replace(/,/g, "").match(/(\d+)\D+(\d+)/);
    return m ? [parseInt(m[1]), parseInt(m[2])] : [null, null];
  };

  // 1) Perfume store — the fully-materialized demo flow project.
  const perfume = await prisma.project.create({
    data: {
      clientId: ahmed,
      titleAr: PROJECTS[0].titleAr,
      titleEn: PROJECTS[0].titleEn,
      description: "أحتاج متجر إلكتروني لبيع العطور",
      categoryId: catIdByEn.get("E-commerce Development")!,
      status: ProjectStatus.PROVIDERS_RECOMMENDED,
      budgetMin: 4000,
      budgetMax: 8000,
      timelineAr: PROJECTS[0].timelineAr,
      timelineEn: PROJECTS[0].timelineEn,
      complexity: Complexity.MEDIUM,
      requiredSkills: BRIEF.skills,
      createdAt: d(PROJECTS[0].date),
    },
  });
  await prisma.brief.create({
    data: {
      projectId: perfume.id,
      titleAr: BRIEF.titleAr, titleEn: BRIEF.titleEn,
      summaryAr: BRIEF.summaryAr, summaryEn: BRIEF.summaryEn,
      objectiveAr: BRIEF.objectiveAr, objectiveEn: BRIEF.objectiveEn,
      scopeAr: BRIEF.scopeAr, scopeEn: BRIEF.scopeEn,
      deliverablesAr: BRIEF.deliverablesAr, deliverablesEn: BRIEF.deliverablesEn,
      requiredSkills: BRIEF.skills,
      budgetMin: 4000, budgetMax: 8000, currency: "SAR",
      timelineAr: BRIEF.timelineAr, timelineEn: BRIEF.timelineEn,
      complexity: Complexity.MEDIUM, complexityPct: BRIEF.complexityPct,
      missingAr: BRIEF.missingAr, missingEn: BRIEF.missingEn,
      providerTypeAr: BRIEF.providerTypeAr, providerTypeEn: BRIEF.providerTypeEn,
      criteriaAr: BRIEF.criteriaAr, criteriaEn: BRIEF.criteriaEn,
      milestones: BRIEF.milestonesAr.map((m, i) => ({
        tAr: m.t, tEn: BRIEF.milestonesEn[i].t, dAr: m.d, dEn: BRIEF.milestonesEn[i].d,
      })),
      qualityScore: 96,
      approvedByClient: true,
    },
  });
  // Conversation: the scripted perfume interview, answered with each question's first chip.
  const chosen = [0, 0, 0, 0, 0];
  const messages: Prisma.JsonArray = [
    { role: "assistant", ar: I18N.ar.chatHello, en: I18N.en.chatHello, ts: minAgo(20).getTime() },
    { role: "user", ar: "أحتاج متجرًا إلكترونيًا لبيع العطور", en: "I need an online store to sell perfumes", ts: minAgo(19).getTime() },
  ];
  CHAT_SCRIPT.forEach((q, i) => {
    messages.push({ role: "assistant", ar: q.qAr, en: q.qEn, chips: q.chips, ts: minAgo(18 - i * 2).getTime() });
    messages.push({ role: "user", ar: q.chips[chosen[i]].ar, en: q.chips[chosen[i]].en, ts: minAgo(17 - i * 2).getTime() });
  });
  messages.push({ role: "assistant", ar: CHAT_DONE.ar, en: CHAT_DONE.en, ts: minAgo(8).getTime() });
  await prisma.conversation.create({
    data: {
      projectId: perfume.id,
      clientId: ahmed,
      messages,
      questionsAsked: 5,
      readyForBrief: true,
      extractedRequirements: {
        serviceType: "E-commerce store development",
        businessContext: "Perfume retail company (Oud Al-Khaleej) launching a direct online sales channel",
        objective: BRIEF.objectiveEn,
        deliverables: BRIEF.deliverablesEn,
        budget: "4,000–8,000 SAR",
        timeline: "3–5 weeks (launch within about a month)",
        technicalRequirements: ["Payment gateway (mada, Apple Pay, STC Pay)", "Local shipping carriers integration", "~50 products at launch"],
        designPreferences: "Existing brand identity to be applied",
        targetAudience: "Perfume buyers across KSA",
        requiredSkills: BRIEF.skills,
        riskFactors: ["Product photography availability", "English storefront scope"],
        missing: BRIEF.missingEn,
      },
      createdAt: d(PROJECTS[0].date),
    },
  });

  // 6 precomputed matches — prototype scores/reasons, engine-computed breakdowns.
  const providerRows = await prisma.provider.findMany({
    include: { skills: { include: { skill: true } }, categories: true, portfolio: true, user: true },
  });
  const asMatchable = (id: string): MatchableProvider => {
    const p = providerRows.find((r) => r.id === id)!;
    return {
      id: p.id,
      nameAr: p.user.name,
      nameEn: p.user.nameEn ?? p.user.name,
      skills: p.skills.map((s) => s.skill.name),
      categoryIds: p.categories.map((c) => c.categoryId),
      priceRangeMin: p.priceRangeMin,
      priceRangeMax: p.priceRangeMax,
      experienceYears: p.experienceYears,
      availability: p.availability,
      rating: p.rating,
      portfolioTitles: p.portfolio.map((i) => i.title + " " + (i.titleEn ?? "")),
    };
  };
  const perfumeBrief: MatchableBrief = {
    requiredSkills: BRIEF.skills,
    budgetMin: 4000,
    budgetMax: 8000,
    categoryId: catIdByEn.get("E-commerce Development")!,
    categoryNames: ["تطوير المتاجر الإلكترونية", "E-commerce Development"],
    titleAr: BRIEF.titleAr,
    titleEn: BRIEF.titleEn,
  };
  for (const m of MATCHES) {
    const providerId = providerByDataId.get(m.pid)!;
    const { breakdown } = scoreProvider(perfumeBrief, asMatchable(providerId));
    await prisma.match.create({
      data: {
        projectId: perfume.id,
        providerId,
        matchScore: m.score,
        reasonAr: m.reasonAr,
        reasonEn: m.reasonEn,
        scoreBreakdown: breakdown,
        status: MatchStatus.RECOMMENDED,
        noteAr: m.pid === 1 ? OPPORTUNITIES[0].noteAr : null,
        noteEn: m.pid === 1 ? OPPORTUNITIES[0].noteEn : null,
        createdAt: minAgo(6),
      },
    });
  }
  // Activity log mirrors t.pdActivity (chat → brief → approve → recommendations).
  const act = async (projectId: string, type: string, textAr: string, textEn: string, at: Date) =>
    prisma.activityLog.create({ data: { projectId, type, textAr, textEn, createdAt: at } });
  await act(perfume.id, "chat_started", "بدأت محادثة توصيف الاحتياج", "Requirement conversation started", minAgo(22));
  await act(perfume.id, "brief_generated", "ولّد الذكاء الاصطناعي الملخص التنفيذي (13 بندًا)", "AI generated the Project Brief (13 items)", minAgo(15));
  await act(perfume.id, "brief_approved", "اعتمد العميل الملخص التنفيذي", "Client approved the Project Brief", minAgo(8));
  await act(perfume.id, "providers_recommended", "تم ترشيح 6 مقدمي خدمة للمشروع", "6 providers recommended for the project", minAgo(6));

  // 2–5) Ahmed's remaining dashboard projects.
  const cafe = await prisma.project.create({
    data: {
      clientId: ahmed,
      titleAr: PROJECTS[1].titleAr, titleEn: PROJECTS[1].titleEn,
      description: "أحتاج هوية بصرية كاملة لمقهى مختص جديد في الرياض",
      categoryId: catId("Branding"),
      status: ProjectStatus.COMPLETED,
      budgetMin: 3500, budgetMax: 6000,
      timelineAr: PROJECTS[1].timelineAr, timelineEn: PROJECTS[1].timelineEn,
      complexity: Complexity.LOW,
      requiredSkills: ["Branding", "Logo Design", "Brand Guidelines"],
      createdAt: d(PROJECTS[1].date),
    },
  });
  await prisma.brief.create({
    data: {
      projectId: cafe.id,
      titleAr: PROJECTS[1].titleAr, titleEn: PROJECTS[1].titleEn,
      summaryAr: "تصميم هوية بصرية متكاملة لمقهى مختص، تشمل الشعار والألوان والتطبيقات الأساسية خلال أسبوعين.",
      summaryEn: "Design a complete brand identity for a specialty café — logo, palette and core applications within two weeks.",
      objectiveAr: "إطلاق علامة مقهى مميزة تعكس جودة القهوة المختصة.",
      objectiveEn: "Launch a distinctive café brand reflecting specialty coffee quality.",
      scopeAr: ["تصميم الشعار", "لوحة الألوان والخطوط", "تطبيقات الهوية (أكواب، قوائم، واجهة)", "دليل استخدام مختصر"],
      scopeEn: ["Logo design", "Color palette & typography", "Identity applications (cups, menus, storefront)", "Short usage guide"],
      deliverablesAr: ["ملف هوية كامل", "دليل الاستخدام", "ملفات مصدرية"],
      deliverablesEn: ["Full identity kit", "Usage guide", "Source files"],
      requiredSkills: ["Branding", "Logo Design", "Brand Guidelines"],
      budgetMin: 3500, budgetMax: 6000,
      timelineAr: "أسبوعان", timelineEn: "2 weeks",
      complexity: Complexity.LOW, complexityPct: 30,
      missingAr: [], missingEn: [],
      providerTypeAr: "وكالة هوية بصرية أو مصمم مستقل", providerTypeEn: "Branding agency or freelance designer",
      criteriaAr: ["أعمال سابقة في المقاهي", "تقييم مرتفع"], criteriaEn: ["Prior café work", "High rating"],
      milestones: [
        { tAr: "الأسبوع 1", tEn: "Week 1", dAr: "الشعار والاتجاه البصري", dEn: "Logo & visual direction" },
        { tAr: "الأسبوع 2", tEn: "Week 2", dAr: "التطبيقات والتسليم", dEn: "Applications & handover" },
      ],
      qualityScore: 85,
      approvedByClient: true,
      createdAt: d(PROJECTS[1].date),
    },
  });
  await act(cafe.id, "status_changed", "اكتمل المشروع وتم التسليم", "Project completed and delivered", d("2026/05/28"));

  await prisma.project.create({
    data: {
      clientId: ahmed,
      titleAr: PROJECTS[2].titleAr, titleEn: PROJECTS[2].titleEn,
      description: "حملة تسويقية متكاملة بالتزامن مع موسم الرياض",
      categoryId: catId("Digital Marketing"),
      status: ProjectStatus.IN_PROGRESS,
      budgetMin: 12000, budgetMax: 18000,
      timelineAr: PROJECTS[2].timelineAr, timelineEn: PROJECTS[2].timelineEn,
      complexity: Complexity.HIGH,
      requiredSkills: ["Digital Marketing", "Media Buying", "Content"],
      createdAt: d(PROJECTS[2].date),
    },
  });
  await prisma.project.create({
    data: {
      clientId: ahmed,
      titleAr: PROJECTS[3].titleAr, titleEn: PROJECTS[3].titleEn,
      description: "تطبيق لحجز مواعيد صالونات نسائية",
      categoryId: catId("Mobile App Development"),
      status: ProjectStatus.DRAFT,
      requiredSkills: [],
      createdAt: d(PROJECTS[3].date),
    },
  });
  const dash = await prisma.project.create({
    data: {
      clientId: ahmed,
      titleAr: PROJECTS[4].titleAr, titleEn: PROJECTS[4].titleEn,
      description: "لوحة تحليلات تفاعلية لمبيعات الفروع",
      categoryId: catId("Data Analysis"),
      status: ProjectStatus.BRIEF_GENERATED,
      budgetMin: 6000, budgetMax: 10000,
      timelineAr: PROJECTS[4].timelineAr, timelineEn: PROJECTS[4].timelineEn,
      complexity: Complexity.MEDIUM,
      requiredSkills: ["Power BI", "Data Modeling"],
      createdAt: d(PROJECTS[4].date),
    },
  });
  await prisma.brief.create({
    data: {
      projectId: dash.id,
      titleAr: PROJECTS[4].titleAr, titleEn: PROJECTS[4].titleEn,
      summaryAr: "بناء لوحة تحليلات مبيعات تفاعلية تجمع بيانات الفروع وتعرض مؤشرات الأداء الرئيسية.",
      summaryEn: "Build an interactive sales analytics dashboard aggregating branch data with key KPIs.",
      objectiveAr: "رؤية موحدة لأداء المبيعات تدعم القرارات الأسبوعية.",
      objectiveEn: "A unified view of sales performance supporting weekly decisions.",
      scopeAr: ["نمذجة البيانات", "بناء اللوحة", "مؤشرات الأداء", "تدريب الفريق"],
      scopeEn: ["Data modeling", "Dashboard build", "KPIs", "Team training"],
      deliverablesAr: ["لوحة Power BI جاهزة", "توثيق النموذج"],
      deliverablesEn: ["Production Power BI dashboard", "Model documentation"],
      requiredSkills: ["Power BI", "Data Modeling"],
      budgetMin: 6000, budgetMax: 10000,
      timelineAr: "4 أسابيع", timelineEn: "4 weeks",
      complexity: Complexity.MEDIUM, complexityPct: 50,
      missingAr: ["ما مصادر البيانات الحالية؟"], missingEn: ["What are the current data sources?"],
      providerTypeAr: "شركة تحليل بيانات", providerTypeEn: "Data analytics company",
      criteriaAr: ["خبرة Power BI", "التزام بالمدة"], criteriaEn: ["Power BI expertise", "Timeline commitment"],
      milestones: [
        { tAr: "الأسبوع 1–2", tEn: "Weeks 1–2", dAr: "النمذجة والربط", dEn: "Modeling & connections" },
        { tAr: "الأسبوع 3–4", tEn: "Weeks 3–4", dAr: "اللوحة والتسليم", dEn: "Dashboard & handover" },
      ],
      qualityScore: 91,
      approvedByClient: false,
      createdAt: d("2026/06/20"),
    },
  });

  // 6) Morning Cup — coffee gear store (provider opportunity #2).
  const coffee = await prisma.project.create({
    data: {
      clientId: morningCup,
      titleAr: OPPORTUNITIES[1].titleAr, titleEn: OPPORTUNITIES[1].titleEn,
      description: "متجر إلكتروني لأدوات القهوة المختصة مع ربط شحن محلي",
      categoryId: catIdByEn.get("E-commerce Development")!,
      status: ProjectStatus.PROVIDERS_RECOMMENDED,
      budgetMin: 6000, budgetMax: 11000,
      timelineAr: OPPORTUNITIES[1].timelineAr, timelineEn: OPPORTUNITIES[1].timelineEn,
      complexity: Complexity.MEDIUM,
      requiredSkills: OPPORTUNITIES[1].skills,
      createdAt: d("2026/06/25"),
    },
  });
  await prisma.brief.create({
    data: {
      projectId: coffee.id,
      titleAr: OPPORTUNITIES[1].titleAr, titleEn: OPPORTUNITIES[1].titleEn,
      summaryAr: "بناء متجر ووكومرس لأدوات القهوة المختصة مع ربط ثلاث شركات شحن محلية.",
      summaryEn: "Build a WooCommerce store for specialty coffee gear with three local carrier integrations.",
      objectiveAr: "قناة بيع مباشرة لعملاء القهوة المختصة.",
      objectiveEn: "A direct sales channel for specialty coffee customers.",
      scopeAr: ["تصميم المتجر", "تهيئة المنتجات", "ربط الشحن (3 شركات)", "بوابة دفع"],
      scopeEn: ["Store design", "Product setup", "Shipping integration (3 carriers)", "Payment gateway"],
      deliverablesAr: ["متجر جاهز للإطلاق", "دليل تشغيل"],
      deliverablesEn: ["Launch-ready store", "Operations guide"],
      requiredSkills: OPPORTUNITIES[1].skills,
      budgetMin: 6000, budgetMax: 11000,
      timelineAr: "4 أسابيع", timelineEn: "4 weeks",
      complexity: Complexity.MEDIUM, complexityPct: 55,
      missingAr: [], missingEn: [],
      providerTypeAr: "مطور متاجر إلكترونية", providerTypeEn: "E-commerce developer",
      criteriaAr: ["خبرة ووكومرس", "خبرة ربط الشحن"], criteriaEn: ["WooCommerce expertise", "Carrier integration experience"],
      milestones: [
        { tAr: "الأسبوع 1", tEn: "Week 1", dAr: "التصميم", dEn: "Design" },
        { tAr: "الأسبوع 2–3", tEn: "Weeks 2–3", dAr: "التطوير والربط", dEn: "Build & integrations" },
        { tAr: "الأسبوع 4", tEn: "Week 4", dAr: "الاختبار والإطلاق", dEn: "QA & launch" },
      ],
      qualityScore: 92,
      approvedByClient: true,
      createdAt: d("2026/06/25"),
    },
  });
  const coffeeBrief: MatchableBrief = {
    requiredSkills: OPPORTUNITIES[1].skills,
    budgetMin: 6000, budgetMax: 11000,
    categoryId: catIdByEn.get("E-commerce Development")!,
    categoryNames: ["تطوير المتاجر الإلكترونية", "E-commerce Development"],
    titleAr: OPPORTUNITIES[1].titleAr, titleEn: OPPORTUNITIES[1].titleEn,
  };
  await prisma.match.create({
    data: {
      projectId: coffee.id,
      providerId: abdullah,
      matchScore: OPPORTUNITIES[1].score,
      reasonAr: "خبرة مباشرة في المتاجر الإلكترونية وربط أنظمة الشحن المحلية",
      reasonEn: "Direct e-commerce experience with local shipping integrations",
      scoreBreakdown: scoreProvider(coffeeBrief, asMatchable(abdullah)).breakdown,
      status: MatchStatus.RECOMMENDED,
      noteAr: OPPORTUNITIES[1].noteAr, noteEn: OPPORTUNITIES[1].noteEn,
      createdAt: minAgo(60 * 5),
    },
  });

  // 7) Badr — salon booking app (brief pending review).
  const salon = await prisma.project.create({
    data: {
      clientId: badr,
      titleAr: "تطبيق حجز مواعيد صالونات", titleEn: "Salon booking app",
      description: "تطبيق جوال لحجز مواعيد الصالونات النسائية",
      categoryId: catId("Mobile App Development"),
      status: ProjectStatus.BRIEF_GENERATED,
      budgetMin: 25000, budgetMax: 45000,
      timelineAr: "10 أسابيع", timelineEn: "10 weeks",
      complexity: Complexity.HIGH,
      requiredSkills: ["Flutter", "Backend"],
      createdAt: d("2026/07/01"),
    },
  });
  await prisma.brief.create({
    data: {
      projectId: salon.id,
      titleAr: "تطبيق حجز مواعيد صالونات", titleEn: "Salon booking app",
      summaryAr: "تطبيق جوال (iOS وAndroid) لحجز مواعيد الصالونات مع إدارة جداول ومدفوعات.",
      summaryEn: "A mobile app (iOS & Android) for salon appointment booking with schedules and payments.",
      objectiveAr: "رقمنة الحجوزات ورفع إشغال الصالونات.",
      objectiveEn: "Digitize bookings and raise salon utilization.",
      scopeAr: ["تصميم التجربة", "تطبيق العميل", "لوحة الصالون", "المدفوعات"],
      scopeEn: ["UX design", "Customer app", "Salon panel", "Payments"],
      deliverablesAr: ["تطبيق منشور على المتجرين", "لوحة إدارة"],
      deliverablesEn: ["Published apps on both stores", "Admin panel"],
      requiredSkills: ["Flutter", "Backend"],
      budgetMin: 25000, budgetMax: 45000,
      timelineAr: "10 أسابيع", timelineEn: "10 weeks",
      complexity: Complexity.HIGH, complexityPct: 80,
      missingAr: ["هل المدفوعات داخل التطبيق مطلوبة في الإطلاق الأول؟"],
      missingEn: ["Are in-app payments required for the first launch?"],
      providerTypeAr: "وكالة تطوير تطبيقات", providerTypeEn: "App development agency",
      criteriaAr: ["تطبيقات منشورة سابقًا", "فريق متكامل"], criteriaEn: ["Previously shipped apps", "Full team"],
      milestones: [
        { tAr: "الأسبوع 1–2", tEn: "Weeks 1–2", dAr: "التصميم", dEn: "Design" },
        { tAr: "الأسبوع 3–8", tEn: "Weeks 3–8", dAr: "التطوير", dEn: "Development" },
        { tAr: "الأسبوع 9–10", tEn: "Weeks 9–10", dAr: "الاختبار والنشر", dEn: "QA & release" },
      ],
      qualityScore: 88,
      approvedByClient: false,
      createdAt: d("2026/07/01"),
    },
  });
  await act(salon.id, "brief_generated", "ولّد الذكاء الاصطناعي الملخص التنفيذي", "AI generated the Project Brief", d("2026/07/01"));

  // 8) Dar Al-Anaqa — Shopify Plus migration (provider opportunity #3).
  const migration = await prisma.project.create({
    data: {
      clientId: dar,
      titleAr: OPPORTUNITIES[2].titleAr, titleEn: OPPORTUNITIES[2].titleEn,
      description: "تحويل متجر قائم بأكثر من 2000 منتج إلى Shopify Plus",
      categoryId: catIdByEn.get("E-commerce Development")!,
      status: ProjectStatus.PROVIDERS_RECOMMENDED,
      budgetMin: 15000, budgetMax: 25000,
      timelineAr: OPPORTUNITIES[2].timelineAr, timelineEn: OPPORTUNITIES[2].timelineEn,
      complexity: Complexity.HIGH,
      requiredSkills: OPPORTUNITIES[2].skills,
      createdAt: d("2026/06/22"),
    },
  });
  const migrationBrief: MatchableBrief = {
    requiredSkills: OPPORTUNITIES[2].skills,
    budgetMin: 15000, budgetMax: 25000,
    categoryId: catIdByEn.get("E-commerce Development")!,
    categoryNames: ["تطوير المتاجر الإلكترونية", "E-commerce Development"],
    titleAr: OPPORTUNITIES[2].titleAr, titleEn: OPPORTUNITIES[2].titleEn,
  };
  await prisma.match.create({
    data: {
      projectId: migration.id,
      providerId: abdullah,
      matchScore: OPPORTUNITIES[2].score,
      reasonAr: "خبرة في نقل المتاجر الكبيرة وتخصص Shopify",
      reasonEn: "Large-catalog migration experience and Shopify specialty",
      scoreBreakdown: scoreProvider(migrationBrief, asMatchable(abdullah)).breakdown,
      status: MatchStatus.RECOMMENDED,
      noteAr: OPPORTUNITIES[2].noteAr, noteEn: OPPORTUNITIES[2].noteEn,
      createdAt: minAgo(60 * 26),
    },
  });

  // 9) Dar Al-Anaqa — fashion store revamp (provider proposal request, "yesterday").
  const revamp = await prisma.project.create({
    data: {
      clientId: dar,
      titleAr: REQUESTS[2].projAr, titleEn: REQUESTS[2].projEn,
      description: "تجديد متجر أزياء قائم مع نقل بيانات أكثر من 2000 منتج",
      categoryId: catIdByEn.get("E-commerce Development")!,
      status: ProjectStatus.PROPOSAL_REQUESTED,
      budgetMin: 15000, budgetMax: 25000,
      timelineAr: REQUESTS[2].timelineAr, timelineEn: REQUESTS[2].timelineEn,
      complexity: Complexity.HIGH,
      requiredSkills: ["E-commerce", "Data Migration"],
      createdAt: d("2026/06/15"),
    },
  });
  await prisma.match.create({
    data: {
      projectId: revamp.id,
      providerId: abdullah,
      matchScore: 83,
      reasonAr: "تخصص مباشر في المتاجر الإلكترونية مع خبرة نقل بيانات",
      reasonEn: "Direct e-commerce specialty with data-migration experience",
      scoreBreakdown: scoreProvider(
        { ...migrationBrief, requiredSkills: ["E-commerce", "Data Migration"], titleAr: REQUESTS[2].projAr, titleEn: REQUESTS[2].projEn },
        asMatchable(abdullah)
      ).breakdown,
      status: MatchStatus.PROPOSAL_REQUESTED,
      noteAr: REQUESTS[2].noteAr, noteEn: REQUESTS[2].noteEn,
      createdAt: minAgo(60 * 24),
    },
  });
  await act(revamp.id, "proposal_requested", "طلب العميل عرضًا من عبدالله الشمري", "Client requested a proposal from Abdullah Al-Shammari", minAgo(60 * 24));

  const counts = {
    users: await prisma.user.count(),
    providers: await prisma.provider.count(),
    clients: await prisma.client.count(),
    categories: await prisma.category.count(),
    skills: await prisma.skill.count(),
    projects: await prisma.project.count(),
    briefs: await prisma.brief.count(),
    matches: await prisma.match.count(),
    activity: await prisma.activityLog.count(),
  };
  console.log("Seed complete:", counts);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
