"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import {
  AdminUsersSchema, AdminUserStatusCommandSchema, AdminUserStatusResultSchema,
  type AdminUserDTO, type AdminUsersDTO,
} from "@/lib/admin/contracts";
import { useI18n } from "@/lib/i18n";
import styles from "./users-layout.module.css";

type Draft = { reason: string; language: string };
type Selection = { userId: string; active: boolean; version: number; compare: boolean };
type Captured = Readonly<{ userId: string; active: boolean; body: string }>;
const emptyDraft: Draft = { reason: "", language: "" };

function responseData(body: unknown): unknown {
  return body && typeof body === "object" && "data" in body ? body.data : undefined;
}
function responseCode(body: unknown): string | null {
  if (!body || typeof body !== "object" || !("error" in body)) return null;
  const error = body.error;
  if (!error || typeof error !== "object" || !("code" in error)) return null;
  return typeof error.code === "string" && /^[A-Z][A-Z0-9_]{0,79}$/.test(error.code) ? error.code : null;
}
function errorMessage(code: string, isAr: boolean) {
  const messages: Record<string, [string, string]> = {
    UNAUTHENTICATED: ["انتهت الجلسة. سجّل دخولك لتحميل بيانات المستخدمين.", "Your session ended. Sign in to load user data."],
    FORBIDDEN: ["هذا الإجراء غير متاح لصلاحيتك الحالية.", "This action is unavailable for your current permissions."],
    STALE_VERSION: ["تغيرت حالة المستخدم أو نسخته. حمّل البيانات الحالية وقارنها قبل طلب جديد؛ السبب باقٍ.", "The user's status or version changed. Load and compare current data before a new request; your reason remains."],
    VALIDATION: ["راجع السبب ولغته. يلزم حرفان غير فارغين على الأقل وحد أقصى ٢٠٠٠ حرف، ولغة BCP47 صحيحة عند تحديدها.", "Review the reason and language. Use at least 2 non-whitespace characters, at most 2,000 characters, and a valid BCP47 language when provided."],
    IDEMPOTENCY_CONFLICT: ["تعارض مفتاح الطلب. مدخلاتك باقية؛ حمّل البيانات الحالية قبل طلب جديد.", "The request key conflicts. Your input remains; load current data before a new request."],
    INVALID_RESPONSE: ["تعذر قراءة نتيجة الطلب. مدخلاتك باقية.", "The request response could not be read. Your input remains."],
    NETWORK: ["تعذر الاتصال بالخادم. مدخلاتك باقية.", "The server could not be reached. Your input remains."],
    NOT_FOUND: ["لم يعد المستخدم متاحًا في هذه القائمة. حمّل البيانات الحالية.", "The user is no longer available in this list. Load current data."],
  };
  return messages[code]?.[isAr ? 0 : 1] ?? (isAr ? "تعذر الطلب. مدخلاتك باقية؛ راجع البيانات وأعد المحاولة." : "The request failed. Your input remains; review the data and try again.");
}

export function UsersScreen({ initialUsers, after, errorCode = null }: {
  initialUsers: AdminUsersDTO | null;
  after?: string;
  errorCode?: string | null;
}) {
  const { t, isAr } = useI18n();
  const copy = (ar: string, en: string) => isAr ? ar : en;
  const [users, setUsers] = useState(initialUsers);
  const [readError, setReadError] = useState(errorCode);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"READ" | "COMMAND" | null>(null);
  const [pending, setPending] = useState(false);
  const [refreshRequired, setRefreshRequired] = useState(false);
  const [readRequired, setReadRequired] = useState(!initialUsers || !!errorCode);
  const [notice, setNotice] = useState<"SAVED" | "REFRESHED" | null>(null);
  const [selected, setSelected] = useState<Selection | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const inFlight = useRef(false);
  const captured = useRef<Captured | null>(null);
  const committed = useRef<string | null>(null);
  const needsRead = useRef(!initialUsers || !!errorCode);
  const listPath = "/api/admin/users" + (after ? "?" + new URLSearchParams({ after }).toString() : "");
  const error = readError ?? commandError;
  const blocked = !!busy || pending || refreshRequired || readRequired || !users;
  const current = users?.users.find(user => user.id === selected?.userId);
  const compareRequired = !!selected && (selected.compare || !current || current.active !== selected.active || current.statusVersion !== selected.version);

  function requireRead(value: boolean) { needsRead.current = value; setReadRequired(value); }
  function deny(code: "UNAUTHENTICATED" | "FORBIDDEN") {
    setUsers(null); setReadError(code); setCommandError(null); setNotice(null); requireRead(true);
  }
  function idleForChange() {
    return !inFlight.current && !captured.current && !committed.current && !needsRead.current && !!users;
  }
  function permitted(user: AdminUserDTO) { return user.id !== users?.selfId && user.role !== "ADMIN"; }

  async function loadCurrent(): Promise<boolean> {
    try {
      const response = await fetch(listPath, { cache: "no-store" });
      if (response.status === 401 || response.status === 403) {
        deny(response.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN"); return false;
      }
      let body: unknown;
      try { body = await response.json(); }
      catch { setReadError("INVALID_RESPONSE"); requireRead(true); return false; }
      if (!response.ok) {
        setReadError(responseCode(body) ?? "UNAVAILABLE"); requireRead(true); return false;
      }
      const parsed = AdminUsersSchema.safeParse(responseData(body));
      if (!parsed.success) { setReadError("INVALID_RESPONSE"); requireRead(true); return false; }
      setUsers(parsed.data); setReadError(null); requireRead(false); return true;
    } catch { setReadError("NETWORK"); requireRead(true); return false; }
  }

  function finishCommitted() {
    const userId = committed.current;
    if (!userId) return;
    committed.current = null; setRefreshRequired(false);
    setDrafts(previous => ({ ...previous, [userId]: { ...emptyDraft } }));
    setSelected(previous => previous?.userId === userId ? null : previous);
    setCommandError(null); setNotice("SAVED");
  }

  async function reload() {
    if (inFlight.current || captured.current) return;
    inFlight.current = true; setBusy("READ"); setNotice(null); setCommandError(null);
    try {
      if (await loadCurrent()) {
        if (committed.current) finishCommitted();
        else setNotice("REFRESHED");
      }
    } finally { inFlight.current = false; setBusy(null); }
  }

  async function execute(operation: Captured) {
    try {
      let response: Response;
      try {
        response = await fetch("/api/admin/users/" + encodeURIComponent(operation.userId), {
          method: "PATCH", cache: "no-store", headers: { "Content-Type": "application/json" }, body: operation.body,
        });
      } catch { setPending(true); setCommandError("NETWORK"); return; }
      if (response.status === 401 || response.status === 403) {
        captured.current = null; setPending(false);
        deny(response.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN"); return;
      }
      let body: unknown;
      try { body = await response.json(); }
      catch { setPending(true); setCommandError("INVALID_RESPONSE"); return; }
      if (!response.ok) {
        const code = responseCode(body);
        if (response.status >= 500 || response.status === 408 || response.status === 429 || !code) {
          setPending(true); setCommandError(code ?? "INVALID_RESPONSE"); return;
        }
        captured.current = null; setPending(false); setCommandError(code);
        if (code === "STALE_VERSION") setSelected(previous => previous?.userId === operation.userId ? { ...previous, compare: true } : previous);
        requireRead(true);
        return;
      }
      const parsed = AdminUserStatusResultSchema.safeParse(responseData(body));
      if (response.status !== 200 || !parsed.success || parsed.data.userId !== operation.userId || parsed.data.active !== operation.active) {
        setPending(true); setCommandError("INVALID_RESPONSE"); return;
      }
      // A replay receipt describes the recorded operation, not current status.
      captured.current = null; setPending(false); setCommandError(null);
      committed.current = operation.userId; setRefreshRequired(true); requireRead(true);
      if (await loadCurrent()) finishCommitted();
    } finally { inFlight.current = false; setBusy(null); }
  }

  async function submit() {
    if (!idleForChange() || !selected || !current || !permitted(current) || compareRequired) return;
    const draft = drafts[selected.userId] ?? emptyDraft;
    const parsed = AdminUserStatusCommandSchema.safeParse({
      operationKey: crypto.randomUUID(), expectedActive: selected.active, expectedVersion: selected.version,
      active: !selected.active, reason: { text: draft.reason, language: draft.language === "" ? null : draft.language },
    });
    if (!parsed.success) { setCommandError("VALIDATION"); setNotice(null); return; }
    inFlight.current = true; setBusy("COMMAND"); setCommandError(null); setNotice(null);
    const operation = { userId: selected.userId, active: parsed.data.active, body: JSON.stringify(parsed.data) };
    captured.current = operation;
    await execute(operation);
  }

  async function retry() {
    if (inFlight.current || !captured.current) return;
    inFlight.current = true; setBusy("COMMAND"); setCommandError(null); setNotice(null);
    await execute(captured.current);
  }

  function open(user: AdminUserDTO) {
    if (!idleForChange() || !permitted(user)) return;
    setSelected({ userId: user.id, active: user.active, version: user.statusVersion, compare: false });
    setCommandError(null); setNotice(null);
  }
  function updateDraft(userId: string, patch: Partial<Draft>) {
    if (!idleForChange()) return;
    setDrafts(previous => ({ ...previous, [userId]: { ...(previous[userId] ?? emptyDraft), ...patch } }));
    setCommandError(null); setNotice(null);
  }
  function compareCurrent() {
    if (!idleForChange() || !selected || !current || !permitted(current)) return;
    setSelected({ userId: current.id, active: current.active, version: current.statusVersion, compare: false });
    setCommandError(null); setNotice(null);
  }
  function roleLabel(role: AdminUserDTO["role"]) {
    return role === "BRAND" ? copy("علامة تجارية", "Brand") : role === "CREATOR" ? copy("صانع محتوى", "Creator") : copy("إدارة", "Admin");
  }
  const activeLabel = (active: boolean) => active ? copy("نشط", "Active") : copy("موقوف", "Suspended");
  const navigationBlocked = blocked;

  return <div className={styles.page} aria-busy={!!busy}>
    <header className={styles.heading}>
      <div className={styles.headingCopy}>
        <h1>{t.usersTitle}</h1>
        <p className={styles.timestamp}>{users ? <>{copy("وقت البيانات (UTC):", "Data as of (UTC):")} <time dateTime={users.asOf} dir="ltr">{users.asOf}</time></> : copy("لم تُحمّل قائمة المستخدمين بعد.", "No user list has been loaded.")}</p>
      </div>
      <button type="button" className={styles.action} disabled={!!busy || pending} onClick={() => void reload()}>{busy ? copy("جارٍ تنفيذ الطلب…", "Processing request…") : copy("تحديث البيانات", "Refresh data")}</button>
    </header>
    <p className={styles.note}>{copy("هذه حسابات محفوظة، وقد تشمل حسابات الاختبار والموقوفة. حالة الدخول منفصلة عن اعتماد الإثبات وصلاحية النشر. الأسماء محفوظة بلغتها الأصلية، وتواريخ الانضمام بالتوقيت العالمي UTC.", "These are saved accounts, including test and suspended accounts. Access status is separate from evidence verification and publication eligibility. Names retain their original language; joining dates use UTC.")}</p>
    {busy && <p className={styles.feedback} role="status">{copy("جارٍ تنفيذ الطلب…", "Processing request…")}</p>}
    {error && <div className={styles.error} role="alert">
      <p>{errorMessage(error, isAr)}</p>
      {users && readRequired && <p>{copy("تُعرض آخر قائمة محمّلة ووقتها. حدّث البيانات قبل تغيير حالة أخرى.", "The last loaded list and its timestamp remain displayed. Refresh before another status change.")}</p>}
      {(error === "UNAUTHENTICATED" || error === "FORBIDDEN") && <Link href="/login" className={styles.textLink}>{copy("تسجيل الدخول", "Sign in")}</Link>}
    </div>}
    {pending && <div className={styles.feedback}>
      <p>{copy("نتيجة الطلب غير مؤكدة. أعد نفس الطلب؛ يُستخدم المستخدم والإجراء والسبب والنسخة والمفتاح نفسها.", "The request result is uncertain. Retry the same request; the user, action, reason, version and key remain identical.")}</p>
      <button type="button" className={styles.action} disabled={!!busy} onClick={() => void retry()}>{copy("أعد نفس الطلب", "Retry the same request")}</button>
    </div>}
    {refreshRequired && <p className={styles.feedback}>{copy("تأكد تسجيل الإجراء، لكن تعذر تحميل القائمة الحالية. السبب باقٍ؛ حدّث البيانات قبل طلب جديد.", "The recorded action is confirmed, but the current list could not be loaded. Your reason remains; refresh before a new request.")}</p>}
    {notice && <p className={styles.feedback} role="status">{notice === "SAVED" ? copy("تأكد تسجيل الإجراء وحُمّلت القائمة الحالية. الحالة المعروضة هي الحالة المحمّلة الآن.", "The recorded action is confirmed and the current list is loaded. Displayed status comes from that current load.") : copy("حُمّلت القائمة الحالية. مدخلاتك باقية؛ قارن النسخة قبل طلب جديد.", "The current list is loaded. Your input remains; compare versions before a new request.")}</p>}

    {!users ? <div className={styles.unavailable}><h2>{copy("بيانات المستخدمين غير متاحة", "User data unavailable")}</h2><p>{copy("حدّث البيانات لعرض القائمة. لا تُعرض بيانات خاصة من نسخة سابقة بعد رفض الوصول.", "Refresh to load the list. Private data from a previous snapshot is hidden after access is denied.")}</p></div> : <>
      <div className={styles.table} role="table" aria-label={t.usersTitle}>
        <div className={`${styles.row} ${styles.tableHeader}`} role="row">
          <span role="columnheader">{t.thUser}</span><span role="columnheader">{t.thRole}</span>
          <span role="columnheader">{copy("الانضمام (UTC)", "Joined (UTC)")}</span><span role="columnheader">{t.thStatus}</span>
          <span role="columnheader">{copy("الإجراء", "Action")}</span>
        </div>
        {users.users.length === 0 && <div role="row"><p className={styles.empty} role="cell" aria-colspan={5}>{copy("لا يوجد مستخدمون في هذه الصفحة.", "No users on this page.")}</p></div>}
        {users.users.map(user => {
          const expanded = selected?.userId === user.id;
          const draft = drafts[user.id] ?? emptyDraft;
          const formId = `admin-user-form-${user.id}`;
          return <div key={user.id} role="rowgroup" data-admin-user={user.id}>
            <div className={styles.row} role="row">
              <div className={styles.identity} role="cell">
                <span className={styles.avatar} aria-hidden="true">{Array.from(user.name)[0] ?? "—"}</span>
                <div className={styles.identityCopy}><p className={styles.name} dir="auto" id={`admin-user-name-${user.id}`}>{user.name || "—"}</p><p className={styles.email} dir="ltr">{user.email}</p></div>
              </div>
              <div className={styles.cell} role="cell" data-label={t.thRole}><span className={styles.chip}>{roleLabel(user.role)}</span></div>
              <div className={styles.cell} role="cell" data-label={copy("الانضمام (UTC)", "Joined (UTC)")}><time dateTime={user.joined} dir="ltr">{user.joined.slice(0, 10).replaceAll("-", "/")}</time></div>
              <div className={styles.cell} role="cell" data-label={t.thStatus}><span className={`${styles.chip} ${user.active ? styles.active : styles.suspended}`}>{activeLabel(user.active)}</span></div>
              <div className={styles.cell} role="cell" data-label={copy("الإجراء", "Action")}>
                {permitted(user) ? <button type="button" className={`${styles.action} ${user.active ? styles.dangerAction : styles.activateAction}`} disabled={blocked} aria-expanded={expanded} aria-controls={formId} onClick={() => open(user)}>{user.active ? copy("إيقاف", "Suspend") : copy("تفعيل", "Activate")}</button> : <span className={styles.protected}>{user.id === users.selfId ? copy("حسابك", "Your account") : copy("حساب إدارة", "Admin account")}</span>}
              </div>
            </div>
            {expanded && selected && <div role="row"><div role="cell" aria-colspan={5} className={styles.expanded} id={formId}>
              <form onSubmit={event => { event.preventDefault(); void submit(); }} aria-describedby={`admin-user-name-${user.id}`}>
                <h2>{selected.active ? copy("إيقاف الحساب", "Suspend account") : copy("تفعيل الحساب", "Activate account")}</h2>
                <p className={styles.formNote}>{copy("الحالة المحددة:", "Selected status:")} {activeLabel(selected.active)} · {copy("النسخة:", "Version:")} <bdi dir="ltr">{selected.version}</bdi>. {copy("التأكيد يغيّر حالة الدخول فقط، ولا يمنح اعتمادًا أو إذن نشر.", "Confirmation changes access status only and does not grant verification or publication permission.")}</p>
                {compareRequired && <div className={styles.comparison}>
                  <p>{copy("قارن البيانات الحالية قبل طلب جديد. السبب لم يتغير.", "Compare current data before a new request. Your reason is unchanged.")}</p>
                  <p>{copy("الحالة في آخر قائمة:", "Status in the last loaded list:")} {activeLabel(user.active)} · {copy("نسخة آخر قائمة:", "Last loaded version:")} <bdi dir="ltr">{user.statusVersion}</bdi></p>
                  <button type="button" className={styles.action} disabled={blocked || !permitted(user)} onClick={compareCurrent}>{copy("استخدم النسخة الحالية", "Use current version")}</button>
                </div>}
                <div className={styles.fields}>
                  <div className={styles.field}><label htmlFor={`admin-user-reason-${user.id}`}>{copy("سبب تغيير الحالة", "Reason for status change")}</label>
                    <textarea id={`admin-user-reason-${user.id}`} rows={3} required minLength={2} maxLength={2000} dir="auto" value={draft.reason} disabled={blocked} onChange={event => updateDraft(user.id, { reason: event.target.value })} />
                  </div>
                  <div className={styles.field}><label htmlFor={`admin-user-language-${user.id}`}>{copy("لغة السبب (اختياري، BCP47)", "Reason language (optional, BCP47)")}</label>
                    <input id={`admin-user-language-${user.id}`} type="text" maxLength={100} dir="ltr" placeholder="ar / en" value={draft.language} disabled={blocked} onChange={event => updateDraft(user.id, { language: event.target.value })} />
                  </div>
                </div>
                <div className={styles.actions}>
                  <button type="submit" className={`${styles.action} ${selected.active ? styles.dangerAction : styles.activateAction}`} disabled={blocked || compareRequired || !permitted(user) || draft.reason.trim().length < 2}>{selected.active ? copy("تأكيد الإيقاف", "Confirm suspension") : copy("تأكيد التفعيل", "Confirm activation")}</button>
                  <button type="button" className={styles.action} disabled={blocked} onClick={() => { if (idleForChange()) { setSelected(null); setCommandError(null); } }}>{copy("إلغاء", "Cancel")}</button>
                </div>
              </form>
            </div></div>}
          </div>;
        })}
      </div>
      <nav className={styles.pagination} aria-label={copy("صفحات المستخدمين", "User pages")}>
        <p>{copy("حتى ٣٠ حسابًا محفوظًا في الصفحة، بترتيب المعرّف.", "Up to 30 saved accounts per page, in ID order.")}</p>
        {after && <Link href="/admin/users" prefetch={false} className={styles.action} aria-disabled={navigationBlocked} tabIndex={navigationBlocked ? -1 : undefined} onClick={event => { if (inFlight.current || captured.current || committed.current || needsRead.current) event.preventDefault(); }}>{copy("الصفحة الأولى", "First page")}</Link>}
        {users.nextCursor ? <Link href={"/admin/users?" + new URLSearchParams({ after: users.nextCursor }).toString()} prefetch={false} className={styles.action} aria-disabled={navigationBlocked} tabIndex={navigationBlocked ? -1 : undefined} onClick={event => { if (inFlight.current || captured.current || committed.current || needsRead.current) event.preventDefault(); }}>{copy("الصفحة التالية", "Next page")}</Link> : <button type="button" className={styles.action} disabled>{copy("الصفحة التالية", "Next page")}</button>}
      </nav>
      {selected && <p className={styles.note}>{copy("الانتقال إلى صفحة أخرى يترك مدخلات السبب غير المحفوظة. الانتقال معطل أثناء الطلب أو عدم تأكد نتيجته أو انتظار تحميل الحالة الحالية.", "Changing pages leaves unsaved reason input. Navigation is disabled during a request, uncertain result or pending current-data reload.")}</p>}
    </>}
  </div>;
}
