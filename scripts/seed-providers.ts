/* eslint-disable no-console */
// Adds demo PROVIDER accounts across all 16 categories for testing the
// matching engine at scale. ADDITIVE — never wipes data (unlike prisma/seed.ts).
// Safe to re-run: existing emails are skipped. Every account's password is "talaqi123".
//
// Usage: npm run seed:providers          — adds 100 providers (default)
//        npx tsx scripts/seed-providers.ts 50
import { PrismaClient, Role, ProviderType, VerifiedStatus } from "@prisma/client";
import bcrypt from "bcryptjs";
import { rankProviders, type MatchableBrief, type MatchableProvider } from "../src/lib/matching";

const prisma = new PrismaClient();
const COUNT = Math.max(1, Math.min(1000, parseInt(process.argv[2] ?? "100", 10) || 100));
const PASSWORD = "talaqi123";
const EMAIL_DOMAIN = "demo.talaqi.sa";

// Deterministic PRNG (mulberry32) — same inputs → same providers on re-run.
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20260714);
const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length)];
const between = (lo: number, hi: number) => lo + rnd() * (hi - lo);
const roundTo = (v: number, step: number) => Math.round(v / step) * step;
const shuffled = <T,>(arr: readonly T[]): T[] => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

// ── Name pools ────────────────────────────────────────────────────────
const MALE = [
  ["سالم", "Salem"], ["ماجد", "Majed"], ["تركي", "Turki"], ["ناصر", "Nasser"],
  ["بندر", "Bandar"], ["سلطان", "Sultan"], ["فيصل", "Faisal"], ["عمر", "Omar"],
  ["يوسف", "Yousef"], ["راكان", "Rakan"], ["عبدالعزيز", "Abdulaziz"], ["مشعل", "Mishal"],
  ["طلال", "Talal"], ["وليد", "Waleed"], ["إبراهيم", "Ibrahim"], ["حسن", "Hassan"],
  ["عادل", "Adel"], ["أنس", "Anas"], ["زياد", "Ziyad"], ["نايف", "Nayef"],
] as const;
const FEMALE = [
  ["لطيفة", "Latifa"], ["دانة", "Dana"], ["أمل", "Amal"], ["هيا", "Haya"],
  ["منيرة", "Munira"], ["جواهر", "Jawaher"], ["شهد", "Shahad"], ["رغد", "Raghad"],
  ["لمى", "Lama"], ["غادة", "Ghada"], ["أسماء", "Asma"], ["وعد", "Waad"],
  ["نوف", "Nouf"], ["مها", "Maha"], ["عبير", "Abeer"], ["ريما", "Rima"],
] as const;
const LAST = [
  ["العسيري", "Al-Asiri"], ["الزهراني", "Al-Zahrani"], ["المالكي", "Al-Maliki"],
  ["الشهري", "Al-Shehri"], ["القرني", "Al-Qarni"], ["البقمي", "Al-Buqami"],
  ["السبيعي", "Al-Subaie"], ["الرويلي", "Al-Ruwaili"], ["الحازمي", "Al-Hazmi"],
  ["العمري", "Al-Amri"], ["الجهني", "Al-Juhani"], ["الخالدي", "Al-Khalidi"],
  ["النعيمي", "Al-Nuaimi"], ["الجابري", "Al-Jabri"], ["الأحمدي", "Al-Ahmadi"],
  ["الحمدان", "Al-Hamdan"], ["السلمي", "Al-Sulami"], ["المهنا", "Al-Muhanna"],
  ["الدغيثر", "Al-Dughaither"], ["البلوي", "Al-Balawi"],
] as const;
const ORG_WORDS = [
  ["نبض", "Nabd"], ["مدار", "Madar"], ["أفق", "Ofoq"], ["سديم", "Sadeem"],
  ["وهج", "Wahaj"], ["ركيزة", "Rakeeza"], ["إتقان", "Itqan"], ["مسار", "Masar"],
  ["بوصلة", "Bawsala"], ["منارة", "Manara"], ["تكامل", "Takamul"], ["رواد", "Rowwad"],
  ["نماء", "Namaa"], ["إشراقة", "Ishraqa"], ["لمعة", "Lamaa"], ["نطاق", "Nitaq"],
  ["سنام", "Sanam"], ["أثر", "Athar"], ["بريق", "Bareeq"], ["درة", "Durra"],
] as const;
const CITIES = [
  ["الرياض", "Riyadh"], ["جدة", "Jeddah"], ["الدمام", "Dammam"], ["الخبر", "Khobar"],
  ["مكة", "Makkah"], ["المدينة", "Medina"], ["أبها", "Abha"], ["تبوك", "Tabuk"],
  ["بريدة", "Buraidah"], ["الطائف", "Taif"], ["جازان", "Jazan"], ["حائل", "Hail"],
] as const;
const COLORS = ["#1B3568", "#14969E", "#C6A15B"] as const;

// Feminine forms for role titles held by female providers.
const feminize = (roleAr: string) =>
  roleAr.replace(/(مطور|مصمم|كاتب|مستشار|محلل|مصور|محاسب|مسوق|خبير|مهندس|محرر|مدير|أخصائي|صانع|مونتير|باحث|عالم|مختبر)/g, "$1ة");

// ── Per-category generation config ───────────────────────────────────
// weight: share of the 100 providers. nameEn must equal Category.nameEn.
type CatCfg = {
  nameEn: string;
  weight: number;
  relatedEn?: string; // occasional secondary category
  roles: [string, string][];
  skills: string[];
  portfolio: [string, string][];
  band: [number, number]; // freelancer SAR range; orgs get a multiplier
  orgTail: [string, string];
};
const CATS: CatCfg[] = [
  {
    nameEn: "Web Development", weight: 8, relatedEn: "E-commerce Development",
    roles: [["مطور مواقع", "Web Developer"], ["مهندس واجهات أمامية", "Frontend Engineer"], ["مطور Full-Stack", "Full-Stack Developer"], ["مطور ووردبريس", "WordPress Developer"]],
    skills: ["React", "Next.js", "Node.js", "WordPress", "Laravel", "Vue.js", "TypeScript", "APIs", "Web Dev"],
    portfolio: [["موقع شركة عقارية بالرياض", "Corporate real-estate website"], ["منصة تعليمية تفاعلية", "Interactive learning platform"], ["موقع حجوزات عيادات", "Clinic booking website"], ["بوابة خدمات حكومية مصغرة", "Mini government services portal"]],
    band: [2500, 12000], orgTail: ["للتقنية", "Tech"],
  },
  {
    nameEn: "E-commerce Development", weight: 10, relatedEn: "Web Development",
    roles: [["مطور متاجر إلكترونية", "E-commerce Developer"], ["خبير منصة سلة", "Salla Platform Expert"], ["مطور Shopify", "Shopify Developer"], ["استشاري تجارة إلكترونية", "E-commerce Consultant"]],
    skills: ["Shopify", "WooCommerce", "Salla", "Zid", "Magento", "Payment Integration", "Shipping APIs", "E-commerce", "Conversion Optimization"],
    portfolio: [["متجر إلكتروني لبيع العطور", "Perfume e-commerce store"], ["متجر أزياء على منصة سلة", "Fashion store on Salla"], ["متجر أدوات قهوة مختصة", "Specialty coffee gear store"], ["نقل متجر كبير إلى Shopify", "Large store migration to Shopify"]],
    band: [3000, 15000], orgTail: ["للتجارة الإلكترونية", "E-commerce"],
  },
  {
    nameEn: "Mobile App Development", weight: 7, relatedEn: "Web Development",
    roles: [["مطور تطبيقات جوال", "Mobile App Developer"], ["مطور Flutter", "Flutter Developer"], ["مطور iOS", "iOS Developer"], ["مطور Android", "Android Developer"]],
    skills: ["Flutter", "React Native", "Swift", "Kotlin", "Firebase", "Mobile Design", "App Store Publishing", "Push Notifications"],
    portfolio: [["تطبيق توصيل طلبات", "Food delivery app"], ["تطبيق حجز مواعيد صالونات", "Salon booking app"], ["تطبيق متجر إلكتروني", "E-commerce mobile app"], ["تطبيق نادٍ رياضي", "Gym membership app"]],
    band: [8000, 35000], orgTail: ["للتطبيقات", "Apps"],
  },
  {
    nameEn: "UI/UX Design", weight: 7, relatedEn: "Graphic Design",
    roles: [["مصمم UI/UX", "UI/UX Designer"], ["مصمم تجربة مستخدم", "UX Designer"], ["باحث تجربة مستخدم", "UX Researcher"], ["مصمم منتجات رقمية", "Product Designer"]],
    skills: ["Figma", "UI/UX", "Prototyping", "Design Systems", "User Research", "Usability Testing", "Mobile Design", "Wireframing"],
    portfolio: [["تصميم تجربة تطبيق مصرفي", "Banking app UX design"], ["واجهات متجر إلكتروني", "E-commerce store UI"], ["نظام تصميم لمنصة تعليمية", "Design system for an education platform"]],
    band: [3000, 12000], orgTail: ["للتصميم", "Design"],
  },
  {
    nameEn: "Graphic Design", weight: 6, relatedEn: "Branding",
    roles: [["مصمم جرافيك", "Graphic Designer"], ["مصمم موشن جرافيك", "Motion Designer"], ["مصمم إعلانات", "Ad Creative Designer"], ["مصمم مطبوعات", "Print Designer"]],
    skills: ["Photoshop", "Illustrator", "Motion Design", "Print Design", "Infographics", "Social Media Design", "Packaging Design"],
    portfolio: [["حملة إعلانات رمضان", "Ramadan campaign visuals"], ["فيديو موشن جرافيك تعريفي", "Explainer motion video"], ["تغليف منتجات عطور", "Perfume packaging design"]],
    band: [1500, 7000], orgTail: ["الإبداعية", "Creative"],
  },
  {
    nameEn: "Branding", weight: 6, relatedEn: "Graphic Design",
    roles: [["مصمم هويات بصرية", "Brand Identity Designer"], ["استشاري علامات تجارية", "Brand Strategist"], ["مصمم شعارات", "Logo Designer"]],
    skills: ["Branding", "Logo Design", "Brand Guidelines", "Visual Identity", "Naming", "Rebranding", "Brand Strategy"],
    portfolio: [["هوية بصرية لمقهى مختص", "Specialty café brand identity"], ["هوية شركة تقنية ناشئة", "Tech startup identity"], ["إعادة تصميم هوية متجر عطور", "Perfume store rebranding"]],
    band: [2500, 10000], orgTail: ["للهوية", "Branding"],
  },
  {
    nameEn: "Digital Marketing", weight: 8, relatedEn: "Social Media Management",
    roles: [["أخصائي تسويق رقمي", "Digital Marketing Specialist"], ["خبير SEO", "SEO Expert"], ["مدير حملات إعلانية", "Paid Media Manager"], ["مسوق أداء", "Performance Marketer"]],
    skills: ["SEO", "Media Buying", "Google Ads", "Meta Ads", "Performance Marketing", "Email Marketing", "Analytics", "Growth Marketing"],
    portfolio: [["حملة إطلاق متجر إلكتروني", "E-commerce launch campaign"], ["تحسين SEO لموقع خدمات", "Services website SEO"], ["حملة تطبيق توصيل", "Delivery app campaign"]],
    band: [3000, 15000], orgTail: ["للتسويق الرقمي", "Digital Marketing"],
  },
  {
    nameEn: "Social Media Management", weight: 6, relatedEn: "Content Writing",
    roles: [["مدير وسائل تواصل", "Social Media Manager"], ["صانع محتوى", "Content Creator"], ["أخصائي مجتمعات رقمية", "Community Manager"]],
    skills: ["Content Calendar", "Community Management", "Instagram Growth", "TikTok", "Snapchat Ads", "Social Media Design", "Influencer Marketing"],
    portfolio: [["إدارة حسابات مطعم", "Restaurant social accounts"], ["نمو حساب متجر عطور", "Perfume store account growth"], ["حملة سناب شات لعلامة أزياء", "Fashion Snapchat campaign"]],
    band: [2000, 8000], orgTail: ["لإدارة المحتوى", "Social Media"],
  },
  {
    nameEn: "Content Writing", weight: 6, relatedEn: "Digital Marketing",
    roles: [["كاتب محتوى", "Content Writer"], ["كاتب إعلاني", "Copywriter"], ["كاتب محتوى تقني", "Technical Writer"], ["محرر لغوي", "Editor"]],
    skills: ["Copywriting", "SEO Content", "Arabic Content", "Technical Writing", "Scriptwriting", "Blog Writing", "Editing & Proofreading"],
    portfolio: [["محتوى موقع شركة تقنية", "Tech company website copy"], ["مقالات SEO لمتجر إلكتروني", "E-commerce SEO articles"], ["سكربتات فيديو تسويقية", "Marketing video scripts"]],
    band: [1000, 5000], orgTail: ["للمحتوى", "Content"],
  },
  {
    nameEn: "Photography & Videography", weight: 6, relatedEn: "Social Media Management",
    roles: [["مصور منتجات", "Product Photographer"], ["مصور فوتوغرافي", "Photographer"], ["صانع أفلام", "Videographer"], ["مونتير فيديو", "Video Editor"]],
    skills: ["Product Photography", "Video Editing", "Videography", "Retouching", "Drone Photography", "Food Photography", "Motion Graphics"],
    portfolio: [["تصوير منتجات عطور", "Perfume product photography"], ["فيديو إعلاني لمطعم", "Restaurant promo video"], ["تصوير قائمة مقهى", "Café menu shoot"]],
    band: [1500, 6000], orgTail: ["للإنتاج المرئي", "Media Production"],
  },
  {
    nameEn: "Business Consulting", weight: 5, relatedEn: "Accounting",
    roles: [["مستشار أعمال", "Business Consultant"], ["مستشار استراتيجيات", "Strategy Consultant"], ["محلل جدوى", "Feasibility Analyst"]],
    skills: ["Strategy", "Feasibility", "Operations", "Market Research", "Business Plans", "Financial Modeling", "PMO"],
    portfolio: [["دراسة جدوى متجر إلكتروني", "E-commerce feasibility study"], ["استراتيجية توسع سلسلة مقاهٍ", "Café chain expansion strategy"], ["هيكلة عمليات شركة ناشئة", "Startup operations design"]],
    band: [5000, 20000], orgTail: ["للاستشارات", "Consulting"],
  },
  {
    nameEn: "Accounting", weight: 5, relatedEn: "Business Consulting",
    roles: [["محاسب قانوني", "Certified Accountant"], ["مستشار زكاة وضريبة", "Zakat & Tax Advisor"], ["محاسب مالي", "Financial Accountant"]],
    skills: ["Zakat & Tax", "VAT", "Bookkeeping", "Financial Reporting", "Odoo", "QuickBooks", "Payroll", "Audit Preparation"],
    portfolio: [["إقرارات زكاة وضريبة", "Zakat & VAT filings"], ["أتمتة محاسبة على Odoo", "Odoo accounting setup"], ["تقارير مالية شهرية", "Monthly financial reporting"]],
    band: [2000, 10000], orgTail: ["للمحاسبة", "Accounting"],
  },
  {
    nameEn: "Legal Consulting", weight: 4, relatedEn: "Business Consulting",
    roles: [["مستشار قانوني", "Legal Consultant"], ["محامي شركات", "Corporate Lawyer"], ["مستشار عقود", "Contracts Advisor"]],
    skills: ["Contracts", "Company Formation", "Trademarks", "Compliance", "Labor Law", "Corporate Law", "Legal Translation"],
    portfolio: [["صياغة عقود موردين", "Supplier contracts drafting"], ["تأسيس شركة تقنية", "Tech company formation"], ["تسجيل علامة تجارية", "Trademark registration"]],
    band: [3000, 15000], orgTail: ["للمحاماة", "Legal"],
  },
  {
    nameEn: "Cybersecurity", weight: 5, relatedEn: "Web Development",
    roles: [["خبير أمن سيبراني", "Cybersecurity Expert"], ["مختبر اختراق", "Penetration Tester"], ["مستشار أمن معلومات", "Information Security Consultant"]],
    skills: ["Pentesting", "Security Audit", "ISO 27001", "SOC Monitoring", "Incident Response", "Vulnerability Assessment", "Security Awareness"],
    portfolio: [["اختبار اختراق لمتجر إلكتروني", "E-commerce penetration test"], ["تأهيل ISO 27001", "ISO 27001 readiness"], ["تقييم ثغرات لتطبيق جوال", "Mobile app vulnerability assessment"]],
    band: [6000, 25000], orgTail: ["للأمن السيبراني", "Cybersecurity"],
  },
  {
    nameEn: "Data Analysis", weight: 5, relatedEn: "AI Solutions",
    roles: [["محلل بيانات", "Data Analyst"], ["مهندس بيانات", "Data Engineer"], ["أخصائي Power BI", "Power BI Specialist"], ["عالم بيانات", "Data Scientist"]],
    skills: ["Power BI", "Python", "SQL", "Tableau", "Data Modeling", "Dashboards", "ETL", "Excel Automation"],
    portfolio: [["لوحة مبيعات Power BI", "Power BI sales dashboard"], ["تحليل بيانات عملاء", "Customer data analysis"], ["أتمتة تقارير مالية", "Financial reports automation"]],
    band: [4000, 15000], orgTail: ["للبيانات", "Data"],
  },
  {
    nameEn: "AI Solutions", weight: 6, relatedEn: "Data Analysis",
    roles: [["مهندس حلول ذكاء اصطناعي", "AI Solutions Engineer"], ["مطور روبوتات محادثة", "Chatbot Developer"], ["خبير تعلم آلة", "ML Engineer"]],
    skills: ["Machine Learning", "LLM Integration", "Chatbots", "NLP", "Computer Vision", "RAG Systems", "Prompt Engineering", "AI Automation"],
    portfolio: [["روبوت محادثة لخدمة العملاء", "Customer service chatbot"], ["نظام توصيات منتجات", "Product recommendation system"], ["تكامل LLM لموقع خدمات", "LLM integration for a services site"]],
    band: [8000, 30000], orgTail: ["للذكاء الاصطناعي", "AI"],
  },
];

// ── Spec generation (all PRNG draws happen here, before any DB writes) ─
type Spec = {
  email: string; nameAr: string; nameEn: string; companyName: string | null;
  providerType: ProviderType; roleAr: string; roleEn: string;
  skills: string[]; catEns: string[];
  min: number; max: number; years: number; availability: string; rating: number;
  languages: string[]; cityAr: string; cityEn: string; color: string; initial: string;
  verified: boolean; portfolio: [string, string][]; phone: string | null; createdAt: Date;
};

function pickType(cat: CatCfg): ProviderType {
  const consulting = ["Business Consulting", "Accounting", "Legal Consulting"].includes(cat.nameEn);
  const r = rnd();
  if (consulting) return r < 0.5 ? ProviderType.CONSULTANT : r < 0.7 ? ProviderType.FREELANCER : ProviderType.COMPANY;
  return r < 0.58 ? ProviderType.FREELANCER : r < 0.74 ? ProviderType.AGENCY : r < 0.9 ? ProviderType.COMPANY : ProviderType.CONSULTANT;
}

function genSpecs(count: number, usedEmails: Set<string>): Spec[] {
  // Weighted, shuffled category assignment — weights sum to 100.
  const catList: CatCfg[] = shuffled(CATS.flatMap((c) => Array<CatCfg>(c.weight).fill(c)));
  const specs: Spec[] = [];
  for (let i = 0; i < count; i++) {
    const cat = catList[i % catList.length];
    const type = pickType(cat);
    const isOrg = type === ProviderType.AGENCY || type === ProviderType.COMPANY;

    let nameAr: string, nameEn: string, emailBase: string, initial: string;
    let role = pick(cat.roles);
    if (isOrg) {
      const word = pick(ORG_WORDS);
      const kindAr = type === ProviderType.AGENCY ? "وكالة" : rnd() < 0.5 ? "شركة" : "مؤسسة";
      const kindEn = type === ProviderType.AGENCY ? "Agency" : "Company";
      nameAr = `${kindAr} ${word[0]} ${cat.orgTail[0]}`;
      nameEn = `${word[1]} ${cat.orgTail[1]} ${kindEn}`;
      emailBase = `${word[1]}.${cat.orgTail[1].replace(/[^A-Za-z]/g, "")}`.toLowerCase();
      initial = word[0].charAt(0);
      // Orgs present a team service line rather than a personal title.
      role = pick(cat.roles.slice(0, 2));
    } else {
      const female = rnd() < 0.42;
      const first = female ? pick(FEMALE) : pick(MALE);
      const last = pick(LAST);
      nameAr = `${first[0]} ${last[0]}`;
      nameEn = `${first[1]} ${last[1]}`;
      emailBase = `${first[1]}.${last[1].replace(/^Al-/, "")}`.toLowerCase();
      initial = first[0].charAt(0);
      if (female) role = [feminize(role[0]), role[1]];
    }
    let email = `${emailBase}@${EMAIL_DOMAIN}`;
    for (let n = 2; usedEmails.has(email); n++) email = `${emailBase}${n}@${EMAIL_DOMAIN}`;
    usedEmails.add(email);

    const skills = shuffled(cat.skills).slice(0, 3 + Math.floor(rnd() * 3)); // 3–5
    const catEns = [cat.nameEn];
    if (cat.relatedEn && rnd() < 0.25) catEns.push(cat.relatedEn);

    const orgMult = isOrg ? between(1.6, 2.5) : 1;
    const [lo, hi] = cat.band;
    let min = roundTo(between(lo * 0.8, lo * 1.5) * orgMult, 250);
    let max = roundTo(between(hi * 0.6, hi * 1.1) * orgMult, 250);
    if (max <= min) max = min * 2;

    const rAvail = rnd();
    const availability = rAvail < 0.45 ? "now" : rAvail < 0.7 ? "1_week" : rAvail < 0.9 ? "2_weeks" : "1_month";
    const verified = i % 10 !== 9; // exactly 90% approved, evenly interleaved
    const city = pick(CITIES);
    const start = Date.UTC(2025, 8, 15);
    const end = Date.UTC(2026, 5, 30);

    specs.push({
      email, nameAr, nameEn,
      companyName: isOrg ? nameEn : null,
      providerType: type,
      roleAr: role[0], roleEn: role[1],
      skills, catEns, min, max,
      years: Math.round(isOrg ? between(4, 14) : type === ProviderType.CONSULTANT ? between(5, 15) : between(2, 10)),
      availability,
      rating: Math.round(between(36, 50)) / 10,
      languages: rnd() < 0.72 ? ["ar", "en"] : ["ar"],
      cityAr: city[0], cityEn: city[1],
      color: pick(COLORS), initial, verified,
      portfolio: verified ? shuffled(cat.portfolio).slice(0, 2 + Math.floor(rnd() * 2)) : [],
      phone: rnd() < 0.6 ? `+966 5${Math.floor(between(0, 6))} ${Math.floor(between(100, 999))} ${Math.floor(between(1000, 9999))}` : null,
      createdAt: new Date(start + rnd() * (end - start)),
    });
  }
  return specs;
}

// ── Main ──────────────────────────────────────────────────────────────
async function main() {
  const catRows = await prisma.category.findMany();
  const catIdByEn = new Map(catRows.map((c) => [c.nameEn, c.id]));
  const missing = CATS.filter((c) => !catIdByEn.has(c.nameEn));
  if (missing.length) throw new Error(`Categories not found (run npm run seed first): ${missing.map((m) => m.nameEn).join(", ")}`);

  const skillRows = await prisma.skill.findMany();
  const skillIds = new Map(skillRows.map((s) => [s.name, s.id]));
  const ensureSkill = async (name: string, categoryId: string) => {
    const hit = skillIds.get(name);
    if (hit) return hit;
    const row = await prisma.skill.create({ data: { name, categoryId } });
    skillIds.set(name, row.id);
    return row.id;
  };

  const usedEmails = new Set((await prisma.user.findMany({ select: { email: true } })).map((u) => u.email));
  const preexisting = new Set(usedEmails);
  const specs = genSpecs(COUNT, usedEmails);
  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  console.log(`Creating ${COUNT} providers…`);
  let created = 0, skipped = 0;
  const perCat = new Map<string, number>();
  for (const s of specs) {
    if (preexisting.has(s.email)) { skipped++; continue; }
    const user = await prisma.user.create({
      data: {
        name: s.nameAr, nameEn: s.nameEn, email: s.email, phone: s.phone,
        passwordHash, role: Role.PROVIDER, companyName: s.companyName, createdAt: s.createdAt,
      },
    });
    const provider = await prisma.provider.create({
      data: {
        userId: user.id,
        providerType: s.providerType,
        roleTitleAr: s.roleAr, roleTitleEn: s.roleEn,
        experienceYears: s.years,
        priceRangeMin: s.min, priceRangeMax: s.max,
        availability: s.availability,
        rating: s.rating,
        verifiedStatus: s.verified ? VerifiedStatus.APPROVED : VerifiedStatus.PENDING,
        locationAr: s.cityAr, locationEn: s.cityEn, location: s.cityEn.toLowerCase(),
        languages: s.languages,
        avatarColor: s.color, avatarInitial: s.initial,
        createdAt: s.createdAt,
      },
    });
    const primaryCatId = catIdByEn.get(s.catEns[0])!;
    for (const catEn of s.catEns) {
      await prisma.providerCategory.create({ data: { providerId: provider.id, categoryId: catIdByEn.get(catEn)! } });
    }
    for (const skill of s.skills) {
      const skillId = await ensureSkill(skill, primaryCatId);
      await prisma.providerSkill.create({ data: { providerId: provider.id, skillId } });
    }
    for (const [title, titleEn] of s.portfolio) {
      await prisma.portfolioItem.create({ data: { providerId: provider.id, title, titleEn } });
    }
    created++;
    perCat.set(s.catEns[0], (perCat.get(s.catEns[0]) ?? 0) + 1);
  }

  console.log(`\nCreated ${created}, skipped ${skipped} (already existed). Password for all: ${PASSWORD}`);
  console.log("Primary category distribution:");
  for (const c of CATS) console.log(`  ${String(perCat.get(c.nameEn) ?? 0).padStart(3)} × ${c.nameEn}`);
  console.log(`Totals now: ${await prisma.provider.count()} providers (${await prisma.provider.count({ where: { verifiedStatus: VerifiedStatus.APPROVED } })} approved)`);

  // ── Smoke check: rank the enlarged pool against three sample briefs ──
  const providerRows = await prisma.provider.findMany({
    where: { verifiedStatus: VerifiedStatus.APPROVED },
    include: { skills: { include: { skill: true } }, categories: true, portfolio: true, user: true },
  });
  const pool: MatchableProvider[] = providerRows.map((p) => ({
    id: p.id,
    nameAr: p.user.name,
    nameEn: p.user.nameEn ?? p.user.name,
    skills: p.skills.map((x) => x.skill.name),
    categoryIds: p.categories.map((c) => c.categoryId),
    priceRangeMin: p.priceRangeMin,
    priceRangeMax: p.priceRangeMax,
    experienceYears: p.experienceYears,
    availability: p.availability,
    rating: p.rating,
    portfolioTitles: p.portfolio.map((i) => i.title + " " + (i.titleEn ?? "")),
  }));
  const briefs: [string, MatchableBrief][] = [
    ["Perfume e-commerce store", {
      requiredSkills: ["Shopify", "Payment Integration", "Shipping APIs"], budgetMin: 6000, budgetMax: 11000,
      categoryId: catIdByEn.get("E-commerce Development")!, categoryNames: ["تطوير المتاجر الإلكترونية", "E-commerce Development"],
      titleAr: "متجر إلكتروني لبيع العطور", titleEn: "Perfume e-commerce store",
    }],
    ["Sales analytics dashboard", {
      requiredSkills: ["Power BI", "SQL", "Data Modeling"], budgetMin: 6000, budgetMax: 10000,
      categoryId: catIdByEn.get("Data Analysis")!, categoryNames: ["تحليل البيانات", "Data Analysis"],
      titleAr: "لوحة تحليلات مبيعات", titleEn: "Sales analytics dashboard",
    }],
    ["Café brand identity", {
      requiredSkills: ["Branding", "Logo Design", "Brand Guidelines"], budgetMin: 3500, budgetMax: 6000,
      categoryId: catIdByEn.get("Branding")!, categoryNames: ["الهوية التجارية", "Branding"],
      titleAr: "هوية بصرية لمقهى", titleEn: "Café brand identity",
    }],
  ];
  console.log("\nMatching smoke check (top 3 per sample brief):");
  for (const [label, brief] of briefs) {
    const ranked = rankProviders(brief, pool);
    console.log(`  ${label}: ${ranked.length} recommended`);
    for (const r of ranked.slice(0, 3)) {
      const p = pool.find((x) => x.id === r.providerId)!;
      console.log(`    ${r.matchScore}  ${p.nameEn}`);
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
