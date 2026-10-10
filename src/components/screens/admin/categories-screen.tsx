"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InfameBrandPattern } from "@/components/infame/brand-pattern";
import { AdminTaxonomySchema, type AdminTaxonomyDTO } from "@/lib/admin/taxonomy-contracts";
import { readCampaignAgentResponse } from "@/lib/campaign-agent/browser-transport";
import { useI18n } from "@/lib/i18n";
import styles from "./admin-catalog-layout.module.css";

type Snapshot = { data: AdminTaxonomyDTO; fresh: boolean };
type Flight = { generation: number; controller: AbortController; timer: ReturnType<typeof setTimeout> };
type Industry = AdminTaxonomyDTO["fame"][number]["industry"];
const fameLabels: Record<Industry, [string, string]> = {
  sports: ["رياضة", "Sports"], acting: ["تمثيل", "Acting"], music: ["موسيقى", "Music"],
  media: ["إعلام", "Media"], business: ["أعمال", "Business"], religion: ["دين", "Religion"],
  academia: ["أكاديميا", "Academia"], gaming: ["ألعاب", "Gaming"], cooking: ["طبخ", "Cooking"],
  fashion: ["أزياء", "Fashion"], travel: ["سفر", "Travel"], "social-only": ["شهرة عبر التواصل", "Social-only fame"],
};

export function CategoriesScreen({ initialTaxonomy, errorCode = null }: {
  initialTaxonomy: AdminTaxonomyDTO | null; errorCode?: string | null;
}) {
  const { lang, isAr, dir } = useI18n();
  const copy = (ar: string, en: string) => isAr ? ar : en;
  const controlsId = useId();
  const [initial] = useState(() => {
    const denied = errorCode === "UNAUTHENTICATED" || errorCode === "FORBIDDEN", parsed = AdminTaxonomySchema.safeParse(initialTaxonomy);
    const snapshot: Snapshot | null = !denied && parsed.success ? { data: parsed.data, fresh: true } : null;
    return { denied, snapshot, error: errorCode ?? (initialTaxonomy !== null && !snapshot ? "INVALID_RESPONSE" : null) };
  });
  const [snapshot, setSnapshot] = useState<Snapshot | null>(initial.snapshot), snapshotRef = useRef(initial.snapshot);
  const [error, setError] = useState<string | null>(initial.error), [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState(initial.denied), deniedRef = useRef(initial.denied);
  const [search, setSearch] = useState(""), [parent, setParent] = useState("");
  const mounted = useRef(false), generation = useRef(0), active = useRef<Flight | null>(null), heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    mounted.current = true;
    const lifetime = { mounted, generation, active };
    return () => {
      lifetime.mounted.current = false; lifetime.generation.current++;
      const flight = lifetime.active.current;
      if (flight) { clearTimeout(flight.timer); flight.controller.abort(); }
      lifetime.active.current = null;
    };
  }, []);
  useEffect(() => { if (denied) heading.current?.focus(); }, [denied]);
  async function refresh() {
    if (!mounted.current || deniedRef.current || active.current) return;
    const controller = new AbortController(), own = ++generation.current;
    let timedOut = false;
    const flight: Flight = { generation: own, controller,
      timer: setTimeout(() => { timedOut = true; controller.abort(); }, 30000) };
    active.current = flight; setBusy(true); setError(null);
    if (snapshotRef.current) { const historical = { ...snapshotRef.current, fresh: false }; snapshotRef.current = historical; setSnapshot(historical); }
    const current = () => mounted.current && !deniedRef.current && generation.current === own && active.current === flight;
    try {
      const response = await fetch("/api/admin/categories", { cache: "no-store", credentials: "same-origin", redirect: "error", signal: controller.signal });
      if (!current()) return;
      if (response.status === 401 || response.status === 403) {
        deniedRef.current = true; generation.current++; controller.abort();
        snapshotRef.current = null; setSnapshot(null); setSearch(""); setParent("");
        setDenied(true); setError(response.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN");
        return;
      }
      const envelope = await readCampaignAgentResponse(response, controller.signal, 2097152);
      if (!current() || controller.signal.aborted) return;
      if (!response.ok) { setError("UNAVAILABLE"); return; }
      const data = envelope && typeof envelope === "object" && "data" in envelope ? envelope.data : undefined;
      const parsed = AdminTaxonomySchema.safeParse(data);
      if (!parsed.success || snapshotRef.current && Date.parse(parsed.data.asOf) < Date.parse(snapshotRef.current.data.asOf)) {
        setError("INVALID_RESPONSE"); return;
      }
      const accepted: Snapshot = { data: parsed.data, fresh: true };
      snapshotRef.current = accepted; setSnapshot(accepted); setError(null);
    } catch {
      if (current()) setError(timedOut ? "TIMEOUT" : controller.signal.aborted ? "CANCELLED" : "UNAVAILABLE");
    } finally {
      clearTimeout(flight.timer);
      if (active.current === flight) { active.current = null; if (mounted.current) setBusy(false); }
    }
  }
  const data = snapshot?.data;
  const view = useMemo(() => {
    const rows = data?.niches ?? [], parents = rows.filter(row => row.parentSlug === null), children = rows.filter(row => row.parentSlug !== null);
    const term = search.trim().toLocaleLowerCase(lang), matches = (row: typeof rows[number]) =>
      !term || [row.slug, row.labelAr, row.labelEn].some(label => label.toLocaleLowerCase(lang).includes(term));
    const bySlug = new Map(rows.map(row => [row.slug, row]));
    const visibleParents = parents.filter(row => (!parent || row.slug === parent) &&
      (matches(row) || children.some(child => child.parentSlug === row.slug && matches(child))));
    const visibleChildren = children.filter(row => (!parent || row.parentSlug === parent) && matches(row));
    return { parents, children, bySlug, visibleParents, visibleChildren };
  }, [data, search, parent, lang]);
  const number = (value: number) => new Intl.NumberFormat(lang).format(value);
  function utc(value: string) {
    return new Intl.DateTimeFormat(lang === "ar" ? "ar-SA" : "en-GB", { timeZone: "UTC", calendar: "gregory", dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  }
  function explainError(code: string) {
    return code === "UNAUTHENTICATED" ? copy("انتهت الجلسة. سجّل الدخول وافتح الصفحة مجددًا.", "Your session ended. Sign in and reopen this page.") :
      code === "FORBIDDEN" ? copy("بيانات التصنيف غير متاحة لصلاحيتك الحالية.", "Taxonomy data is unavailable for your current permissions.") :
      code === "TIMEOUT" ? copy("لم يصل الرد في الوقت المحدد. يمكنك إعادة القراءة نفسها.", "The response timed out. You can retry the same read.") :
      copy("تعذّر تأكيد التصنيف وأعداده الحالية. احتفظنا بالنسخة السابقة إن وُجدت.", "The current catalog and counts could not be confirmed. Any previous snapshot is retained.");
  }
  return <section className={styles.page} dir={dir} data-admin-taxonomy>
    <header className={styles.header}><div className={styles.headerCopy}>
      <h1 ref={heading} tabIndex={-1}>{copy("التخصصات ومجالات الشهرة", "Niches and fame industries")}</h1>
      <p className={styles.timestamp}>{data ? <>{copy("وقت القراءة:", "Read at:")} <time dateTime={data.asOf}>{utc(data.asOf)}</time> <bdi>UTC</bdi></> : copy("وقت القراءة غير متاح", "Read time unavailable")}</p>
    </div><div className={styles.headerActions}><InfameBrandPattern compact />
      <Button type="button" variant="outline" disabled={busy || denied} onClick={() => void refresh()} data-admin-taxonomy-refresh>
        <RefreshCw aria-hidden="true" />{busy ? copy("جارٍ التحميل…", "Loading…") : copy("تحديث الأعداد", "Refresh counts")}
      </Button>
    </div></header>
    <p className={styles.note}>{copy("الأعداد تشمل اختيارات صناع المحتوى المحفوظة، بما فيها الخاصة والاختبارية وغير النشطة. يُحسب الصانع مرة واحدة لكل اختيار مطابق، ويمكن أن يظهر في عدة تخصصات. عدد التصنيفات مستقل عن عدد الاختيارات.", "Counts cover stored creator assignments, including private, test and inactive records. Each creator is counted once per exact tag and may appear in several niches. Catalog size is separate from assignment counts.")}</p>
    {error && <div className={styles.error} role="alert"><p>{explainError(error)}</p>
      {!denied && <Button type="button" variant="outline" disabled={busy} onClick={() => void refresh()}>{copy("أعد القراءة نفسها", "Retry the same read")}</Button>}
      {denied && <Button asChild variant="outline"><Link href="/login" prefetch={false}>{copy("تسجيل الدخول", "Sign in")}</Link></Button>}
    </div>}
    {snapshot && !snapshot.fresh && <p className={styles.notice} role="status">{copy("تظهر أعداد من نسخة سابقة؛ لم يتأكد تحديثها الحالي.", "Counts from a previous snapshot are shown; their current refresh is unconfirmed.")}</p>}
    {busy && <p className={styles.notice} role="status">{copy("بانتظار الرد الفعلي…", "Waiting for the actual response…")}</p>}
    <div className={styles.catalogSummary} aria-label={copy("حجم قائمة التصنيف", "Catalog size")}>
      <p>{copy("عناصر القائمة", "Catalog entries")}: <strong data-taxonomy-catalog-count>{data ? number(data.niches.length) : copy("غير متاح", "Unavailable")}</strong></p>
      <p>{copy("التخصصات الرئيسية", "Parent niches")}: <strong>{data ? number(view.parents.length) : copy("غير متاح", "Unavailable")}</strong></p>
      <p>{copy("التخصصات الفرعية", "Child niches")}: <strong>{data ? number(view.children.length) : copy("غير متاح", "Unavailable")}</strong></p>
    </div>
    {data ? <>
      <p className={styles.note}>{copy("نسخة القائمة:", "Catalog version:")} <bdi dir="ltr">{data.source.version}</bdi> · {copy("تاريخ مراجعة المصدر:", "Source checked:")} <bdi dir="ltr">{data.source.checkedAt}</bdi></p>
      <div className={styles.filters}>
        <label htmlFor={controlsId + "-search"}>{copy("ابحث في التخصصات", "Search niches")}<Input id={controlsId + "-search"} type="search" value={search} maxLength={200} onChange={event => setSearch(event.target.value)} data-taxonomy-search /></label>
        <label htmlFor={controlsId + "-parent"}>{copy("التخصص الرئيسي", "Parent niche")}<select id={controlsId + "-parent"} value={parent} onChange={event => setParent(event.target.value)} data-taxonomy-parent-filter>
          <option value="">{copy("كل التخصصات الرئيسية", "All parent niches")}</option>
          {view.parents.map(row => <option value={row.slug} key={row.slug}>{isAr ? row.labelAr : row.labelEn}</option>)}
        </select></label>
        <Button type="button" variant="outline" onClick={() => { setSearch(""); setParent(""); }}>{copy("مسح التصفية", "Clear filters")}</Button>
      </div>
      <h2 className={styles.sectionTitle}>{copy("التخصصات الرئيسية", "Parent niches")}</h2>
      <p className={styles.note}>{copy("عدد التخصص الرئيسي يعكس اختياره المباشر. تظهر اختيارات التخصصات الفرعية منفصلة.", "A parent count reflects its direct assignment. Child assignments are shown separately.")}</p>
      <div className={styles.categoryGrid} data-taxonomy-parent-grid>
        {view.visibleParents.map(row => <article className={styles.categoryCard} key={row.slug} data-taxonomy-niche={row.slug}>
          <h3>{isAr ? row.labelAr : row.labelEn}</h3><p><bdi data-taxonomy-assignment-count>{number(row.assignmentCount)}</bdi> {copy("صانع محتوى باختيار مطابق", "creators with this exact tag")}</p><p className={styles.slug}><bdi>{row.slug}</bdi></p>
        </article>)}
      </div>
      {view.visibleParents.length === 0 && <p className={styles.empty}>{copy("لا توجد تخصصات رئيسية تطابق التصفية.", "No parent niches match the filters.")}</p>}
      <div className={styles.sectionHeading}><h2>{copy("التخصصات الفرعية", "Child niches")}</h2><p className={styles.note}>{copy("عدد النتائج:", "Results:")} <bdi>{number(view.visibleChildren.length)}</bdi></p></div>
      <div className={styles.chipRegion} data-taxonomy-child-region>
        {view.visibleChildren.map(row => <article className={styles.taxonomyChip} key={row.slug} data-taxonomy-niche={row.slug}>
          <div><h3>{isAr ? row.labelAr : row.labelEn}</h3><p className={styles.small}>{row.parentSlug && (isAr ? view.bySlug.get(row.parentSlug)!.labelAr : view.bySlug.get(row.parentSlug)!.labelEn)}</p></div>
          <p><bdi data-taxonomy-assignment-count>{number(row.assignmentCount)}</bdi> {copy("اختيار مطابق", "exact assignments")}</p>
        </article>)}
        {view.visibleChildren.length === 0 && <p className={styles.empty}>{copy("لا توجد تخصصات فرعية تطابق التصفية.", "No child niches match the filters.")}</p>}
      </div>
      <div className={styles.sectionHeading}><h2>{copy("مجالات الشهرة", "Fame industries")}</h2><p className={styles.note}>{copy("مجالات مستقلة عن التخصص", "Fields independent of niches")} · <bdi data-taxonomy-fame-count>{number(data.fame.length)}</bdi></p></div>
      <p className={styles.note}>{copy("التخصصات ذات الصلة تساعد على الفهم، وتبقى أعداد اختياراتها منفصلة.", "Related niches provide context; their assignment counts remain separate.")}</p>
      <div className={styles.categoryGrid} data-taxonomy-fame-region>{data.fame.map(row => <article className={styles.categoryCard} key={row.industry} data-taxonomy-fame={row.industry}>
        <h3>{fameLabels[row.industry][isAr ? 0 : 1]}</h3><p><bdi data-taxonomy-assignment-count>{number(row.assignmentCount)}</bdi> {copy("صانع محتوى باختيار مطابق", "creators with this exact tag")}</p>
        <p className={styles.small}>{copy("تخصصات ذات صلة:", "Related niches:")} {row.relatedNicheSlugs.length ? row.relatedNicheSlugs.map(slug => isAr ? view.bySlug.get(slug)!.labelAr : view.bySlug.get(slug)!.labelEn).join(" · ") : copy("لا توجد تخصصات ذات صلة", "No related niches")}</p>
      </article>)}</div>
      <section className={styles.unknownRegion} aria-labelledby={controlsId + "-unknown"}>
        <h2 id={controlsId + "-unknown"}>{copy("اختيارات محفوظة خارج القائمة", "Stored assignments outside the catalog")}</h2>
        <p>{copy("صناع محتوى لديهم أي تخصص غير معروف:", "Creators with any unknown niche tag:")} <bdi data-taxonomy-unknown="nicheCreators">{number(data.unknownAssignments.nicheCreators)}</bdi></p>
        <p>{copy("صناع محتوى لديهم أي مجال شهرة غير معروف:", "Creators with any unknown fame tag:")} <bdi data-taxonomy-unknown="fameCreators">{number(data.unknownAssignments.fameCreators)}</bdi></p>
      </section>
    </> : <div className={styles.unavailable}><h2>{copy("قائمة التصنيف وأعداد الاختيارات غير متاحة", "Catalog and assignment counts unavailable")}</h2><p>{denied ? copy("جدّد الدخول وافتح الصفحة مجددًا لعرض البيانات.", "Renew authentication and reopen this page to view data.") : copy("حمّل قراءة مسموحة لعرض القائمة والأعداد الفعلية.", "Load an authorized snapshot to see the catalog and actual counts.")}</p></div>}
  </section>;
}
