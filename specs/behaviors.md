# Talaqi Prototype — Behavioral Specification (State, Routing, Handlers)

**Sources of truth**
- `design_handoff_talaqi_backend/support.js` (1,658 lines) — this is the **generic dc-runtime** (template compiler, `sc-if`/`sc-for`, `{{ }}` expression resolver, `style-*` pseudo-class sheet, React 18 UMD bootstrap). It contains **no app logic**. Its semantics matter only insofar as the Next.js rebuild must reproduce equivalent rendering behavior (documented in §9).
- `design_handoff_talaqi_backend/Talaqi Platform.dc.html`, lines 1557–2181 — the `<script data-dc-script>` block defining `class Component extends DCLogic`. **This is the app's entire state model, routing and handler set.** Everything in §1–§8 comes from here.
- `design_handoff_talaqi_backend/talaqi-data.js` (633 lines) — demo data + full `I18N` dictionary (`I18N.ar`, `I18N.en`), loaded at mount via dynamic `import('./talaqi-data.js')`.

Target: Next.js 15 + TypeScript + Tailwind. The prototype is a **single React class component** holding all state; the rebuild may split it (e.g., Zustand/Context + per-page components) but must reproduce every transition, timing and visual state below exactly.

---

## 1. Complete state model

Component props (from `data-props`): `defaultLang: 'ar' | 'en'` (default `'ar'`), `defaultView: string` (default `'landing'`, unused in logic — view is hardcoded in state).

| State key | Initial value | Type | Controls |
|---|---|---|---|
| `lang` | `null` | `'ar' \| 'en' \| null` | UI language. Effective language = `state.lang ?? props.defaultLang ?? 'ar'` (see `lang()`), so `null` means "Arabic by default". `isAr()` ⇒ `lang() === 'ar'`. Drives `dir` (`rtl`/`ltr`), all `t.*` lookups, and all `ar ? x.ar : x.en` data picks. |
| `view` | `'landing'` | `'landing' \| 'app'` | Top-level shell: public site vs. authenticated app. `isLanding` / `isApp` template flags. |
| `role` | `'client'` | `'client' \| 'provider' \| 'admin'` | Which app persona is active (sidebar nav set, avatar, page flags). |
| `cPage` | `'home'` | `'home' \| 'chat' \| 'brief' \| 'matches' \| 'projects' \| 'detail' \| 'profile' \| 'settings'` | Client dashboard page. |
| `pPage` | `'home'` | `'home' \| 'requests' \| 'profile' \| 'settings'` | Provider dashboard page. |
| `aPage` | `'overview'` | `'overview' \| 'users' \| 'providers' \| 'projects' \| 'briefs' \| 'analytics' \| 'cats' \| 'settings'` | Admin dashboard page. |
| `data` | `null` | module namespace of `talaqi-data.js` | All demo content + `I18N`. Until loaded, `t()` returns a Proxy yielding `''` for every key and `renderVals()` returns empty arrays for all list vals (loading-safe render). |
| `messages` | `[]` | `{ who: 'ai' \| 'user', text: string }[]` | Chat transcript (both scripted and live modes share it). |
| `step` | `-1` | number | Index into `CHAT_SCRIPT` (5 questions, indices 0–4) of the **currently asked** question. `-1` = not started. |
| `typing` | `false` | boolean | AI typing indicator bubble (`sc-if {{ typing }}`); also blocks `send()`. |
| `chatDone` | `false` | boolean | Scripted interview finished (or live mode reached ≥3 history entries). Template val `chatDone = s.chatDone && !s.briefReady` gates the **"Generate brief" button** (`sc-if {{ chatDone }}`). |
| `started` | `false` | boolean | First user message sent (scripted mode). Hides starter chips: `showStarters = !started && !liveMode && !typing`. |
| `draft` | `''` | string | Controlled chat input value. |
| `liveMode` | `false` | boolean | Scripted demo vs. live LLM chat (`window.claude.complete`). Toggle tabs styling. |
| `liveHistory` | `[]` | `{ role: 'user' \| 'assistant', content: string }[]` | LLM message history for live mode (separate from `messages`, which is display-only). |
| `generating` | `false` | boolean | Brief-generation modal open (`sc-if {{ generating }}`); also blocks `send()`. |
| `genStep` | `0` | 0–4 | Progress through the 4 generation steps (0-based active index; value 4 = all done, transient). |
| `briefReady` | `false` | boolean | A brief exists. Adds sidebar badges (`'1'` on Brief, `'6'` on Matches), bumps client stat "briefs completed" from `'4'` to `'5'`, and hides the generate button (`chatDone && !briefReady`). |
| `editing` | `false` | boolean | Brief page inline-edit mode (swaps text ↔ inputs via 3× `sc-if {{ editing }}` / `{{ notEditing }}` pairs). |
| `edits` | `{}` | `{ title?, summary?, budget? }` | User's brief edits; displayed value = `edits.x ?? BRIEF.x(lang)` (nullish per-field, `!= null` check). Edits survive leaving/re-entering the page and are **not** cleared on approve. |
| `proposals` | `{}` | `{ [providerId: number]: true }` | Client → provider "request proposal" flags on Matches page. Drives per-card `requested`/`notRequested` and the Project Detail "requested providers" list + step tracker. |
| `ops` | `{}` | `{ [oppId: number]: 'a' \| 'd' }` | Provider opportunity decisions (accept/decline). Absent key = pending. |
| `pending` | `{}` | `{ [index: number]: 'a' \| 'r' }` | Admin decisions on `ADMIN.pendingProviders` (approve/reject), keyed by **array index**. |
| `toast` | `null` | `string \| null` | Toast message text; non-null shows toast (`sc-if {{ toast }}`). |
| `pubPage` | `'home'` | `'home' \| 'about' \| 'clients' \| 'providers' \| 'contact' \| 'login' \| 'signup'` | Public-site page. |
| `signupRole` | `'client'` | `'client' \| 'provider'` | Signup form role selector; styles the two role cards and submit button color. |
| `notif` | `{ 0: true, 1: true, 2: false }` | `{ [i: 0\|1\|2]: boolean }` | Settings page notification toggles (labels from `t.notifs[i]`). |
| `reqs` | `{}` | `{ [requestId: number]: 's' \| 'd' }` | Provider "proposal requests" decisions (send proposal / decline). Absent = pending. |
| `briefOpen` | `null` | `number \| null` | Admin Briefs page: which row's review panel is expanded (only row 0 can actually open; others toast "demo only"). |

**Instance (non-state) fields:** `_chatRef` (React ref to the chat scroll container, created in `componentDidMount`), `_toastTimer`, `_genTimer` (setTimeout handles).

**Mount:** `componentDidMount` → `import('./talaqi-data.js').then(m => setState({ data: m }))` and `this._chatRef = React.createRef()`. In the rebuild, import data statically and skip the loading state, or keep it for fidelity.

---

## 2. Routing graph

There is **no URL routing** — everything is state-driven conditional render inside one page. The Next.js rebuild may map these to routes but must preserve the transitions and the "scroll to top" behavior on every navigation (`set(patch)` helper = `setState(patch); window.scrollTo({ top: 0 })` — **instant**, not smooth).

### 2.1 Top-level
```
view = 'landing'  ── pubPage ∈ { home, about, clients, providers, contact, login, signup }
view = 'app'      ── role ∈ { client, provider, admin } × (cPage | pPage | aPage)
```

### 2.2 Public site handlers
| Handler (template name) | Effect |
|---|---|
| `goLanding` | `{ view:'landing', pubPage:'home' }` + scrollTop |
| `goPubAbout` / `goPubClients` / `goPubProviders` / `goPubContact` | `goPub(p)` = `{ view:'landing', pubPage: p }` + `window.scrollTo({top:0})` (instant) |
| `goLogin` | `goPub('login')` |
| `goSignupC` | `setState({ signupRole:'client' })` then `goPub('signup')` |
| `goSignupP` | `setState({ signupRole:'provider' })` then `goPub('signup')` |
| `openClient` / `demoAsClient` | `{ view:'app', role:'client', cPage:'home' }` + scrollTop |
| `openProvider` / `demoAsProvider` | `{ view:'app', role:'provider', pPage:'home' }` + scrollTop |
| `demoAsAdmin` | `{ view:'app', role:'admin', aPage:'overview' }` + scrollTop |
| `goTop` | `window.scrollTo({ top: 0, behavior: 'smooth' })` |
| `scrollHow` / `scrollFeatures` / `scrollCats` / `scrollPricing` | `anchorScroll(id)` with ids `tq-how`, `tq-features`, `tq-cats`, `tq-pricing` |

**`anchorScroll(id)` logic:** if not on landing/home, first `setState({ view:'landing', pubPage:'home' })` then `setTimeout(() => scrollTo(id), 200)`; else scroll immediately. **`scrollTo(id)`**: smooth-scroll to `el.getBoundingClientRect().top + window.scrollY - 70` (70px sticky-header offset).

**Header nav active styles** (computed vals): `wClients/cClients`, `wProviders/cProviders`, `wAbout/cAbout`, `wContact/cContact` — font-weight `700` and color `#1B3568` when that `pubPage` is active, else weight `500`, color `#3D4C68`.

### 2.3 App page flags (all `sc-if` roots)
`inApp = view === 'app'`. Flags: `isClientHome|Chat|Brief|Matches|Projects|Detail|Profile`, `isProviderHome|Requests|Profile`, `isAdminOverview|Users|Providers|Projects|Briefs|Analytics|Cats`, and shared `isSettings` = settings page of **any** role (`settingsLabel = t.cNavSettings`).

### 2.4 Sidebar nav (per role)
Built by `navItem(label, active, go, badge)`. Item vals: `bg` = `#EEF3FB` active / `transparent`; `fg` = `#1B3568` active / `#4A5A76`; `w` (font-weight) = `700` active / `500`; `dot` color = `#14969E` active / `#C9D3E2`; `dotR` (dot border-radius) = `'2px'` active / `'50%'`; `badge` string or `false` (`sc-if {{ n.badge }}`).

- **Client:** Home→`cPage:'home'` (label `t.cNavHome`), New request→`'chat'` (`t.cNavNew`), Brief→`'brief'` (`t.cNavBrief`, badge `'1'` iff `briefReady`), Matches→`'matches'` (`t.cNavMatches`, badge `'6'` iff `briefReady`), Projects→`'projects'` (`t.cNavProjects`), Profile→`'profile'` (label `t.cpTitle`), Settings→`'settings'` (`t.cNavSettings`). Note `cPage:'detail'` is reachable only from project rows / detail links, not the sidebar.
- **Provider:** Home (`t.pNavHome`, badge `'3'` always), Requests (`t.pNavRequests`, badge `'2'` always), Profile (`t.pNavProfile`), Settings (`t.pNavSettings`).
- **Admin:** Overview, Users, Providers (badge `'12'` always), Projects, Briefs, Analytics, Cats, Settings (`t.aNavOverview` … `t.aNavSettings`).

### 2.5 Role switcher (app top bar)
`roles` = 3 pill buttons (`t.roleClient/t.roleProvider/t.roleAdmin`); click → `setState({ role: key })` **only** (keeps each role's last page; no scroll). Active pill: `bg:#fff`, `fg:#1B3568`, `shadow:'0 2px 6px rgba(20,40,80,.12)'`; inactive: transparent / `#7684A0` / none.
Avatar: `avatarBg` = `#14213A` admin / `#14969E` provider / `#1B3568` client; `avatarInit` = `'م'` / `'ع'` / `'أ'`. `sidebarTitle` = `t.clientName` (client) / `PROVIDERS[0].ar|en` (provider) / `'إدارة المنصة'` | `'Platform admin'` (admin, hardcoded, not i18n keys).

### 2.6 Other in-app navigation handlers
`goChat` → `cPage:'chat'`; `goProjects` → `'projects'`; `goBrief` → `'brief'`; `goMatches` → `'matches'`; each project row `open` → `cPage:'detail'` (all + instant scrollTop).

---

## 3. Toast system

`showToast(msg)`: `setState({ toast: msg })`, `clearTimeout(this._toastTimer)`, then `_toastTimer = setTimeout(() => setState({ toast: null }), 2600)`. **2600 ms auto-dismiss, timer resets on every new toast.** Template: `sc-if {{ toast }}`; positioning val `toastShift` = `'50%'` in Arabic / `'-50%'` in English (translateX for centering under RTL/LTR).

Toast triggers (i18n key of message): brief approve → `t.briefApprovedToast`; match request → `t.proposalSent`; provider accept → `t.accepted`; provider send proposal → `t.reqSentLbl`; contact form send → `t.contactSentToast`; signup submit → `t.signupToast`; any "demo only" action (`demoToast`, non-first admin brief review) → `t.demoOnly`.

---

## 4. AI chat flow (client `cPage:'chat'`)

### 4.1 Mode toggle
Two tabs: **Scripted** (`setScripted` → `liveMode:false`) and **Live** (`setLive` → `liveMode:true` + `ensureHello()`). `ensureHello()` pushes `{who:'ai', text: t.chatHello}` only if `messages.length === 0`. Tab styles: active tab `bg:#fff`; scripted active `fg:#1B3568`, live active `fg:#0E7A81`; inactive `bg:transparent`, `fg:#7684A0`.

### 4.2 Message rendering
Each message maps to: `align` = `flex-start` (ai) / `flex-end` (user); `bg` = `#fff` (ai) / `#1B3568` (user); `fg` = `#2C3A54` / `#fff`; `border` = `1px solid #E4E9F1` / `none`; `radius` = `4px 16px 16px 16px` (ai) / `16px 4px 16px 16px` (user). (These are physical corner values in the source; under RTL the browser renders them as written — replicate as-is.)

**Auto-scroll:** every `pushMsg` calls `scrollChat()` → `setTimeout(60ms)` then `el.scrollTop = el.scrollHeight` on the chat container ref.

### 4.3 Input
Controlled input bound to `draft` (`onDraft` = onChange). `onDraftKey`: Enter ⇒ `send(draft)` + clear draft. Send button `sendDraft` does the same. **`send(text)` guard:** trims; returns if empty, or `typing`, or `generating`. Dispatch: `liveMode` → `sendLive`; `!started` → `startScript`; `!chatDone` → `answerScript`; (if `chatDone` and not live, sending does nothing).

### 4.4 Starter chips
`showStarters = !started && !liveMode && !typing`. Three chips from `t.chatStarter1..3`; click → `startScript(text)`.

### 4.5 Scripted flow (`CHAT_SCRIPT` = 5 questions, each `{ qAr, qEn, chips: [{ar,en}] }`)
- `startScript(userText)`: push user msg → `setState({ started:true, typing:true })` → after **1100 ms**: `setState({ typing:false, step:0 })` + push AI `CHAT_SCRIPT[0].qAr|qEn`.
- `answerScript(text)`: push user msg → `typing:true` → after **1000 ms**: if `next < 5`, `{typing:false, step:next}` + push `CHAT_SCRIPT[next]` question; else `{typing:false, step:next, chatDone:true}` + push `CHAT_DONE.ar|en` ("I have the full picture — 9 core requirements captured… Ready to generate your Project Brief.").
- **Answer chips:** `curQ` = `CHAT_SCRIPT[step]` iff `started && !chatDone && !typing && 0 ≤ step < 5`. `showChips = !!curQ && !liveMode`. Chip click → `answerScript(chipText)` (localized text becomes the user message). Chip counts per question: 2, 2, 2, 3, 3.
- Typing indicator: `sc-if {{ typing }}` bubble.

### 4.6 Live mode (`sendLive`)
Push user msg; append `{role:'user', content}` to `liveHistory`; `typing:true`. System prompt (exact strings in source, AR/EN variants): "Talaqi platform assistant, professional procurement consultant… one clarifying question per message, max 5 total… max 3 lines." Calls `await window.claude.complete({ system, messages: hist, max_tokens: 400 })`. On success: `typing:false`, append assistant reply to `liveHistory`, set `chatDone: liveHistory.length >= 3` (i.e., after the 2nd user turn: user+assistant+user = 3 entries at evaluation time), push AI msg. On error: `typing:false` + push fallback AI msg (AR: "تعذر الاتصال بالذكاء الحي حاليًا — يمكنك متابعة المحادثة التجريبية." / EN: "Live AI is unavailable right now — you can continue with the demo conversation."). Note `sc-if {{ liveMode }}` shows a live-mode note (`t.liveNote`). In the rebuild, replace `window.claude.complete` with your LLM endpoint or stub it to always show the fallback.

### 4.7 "Generate brief" button + 4-step modal
Button shown when `chatDone && !briefReady` (val `chatDone`); label `t.generateBrief`; onClick `generate` → `generateBrief()`:
```
setState({ generating: true, genStep: 0 })   // modal opens, step 1 active
t=850ms   genStep: 1                          // step 1 done, step 2 active
t=1700ms  genStep: 2
t=2550ms  genStep: 3
t=3400ms  genStep: 4                          // all four done
t=4250ms  setState({ generating:false, briefReady:true, cPage:'brief' }); window.scrollTo({top:0})
```
(Implementation: recursive `setTimeout(tick, 850)`, `i` from 1; `i<=4` sets `genStep:i`, `i===5` closes.) Modal content `sc-if {{ generating }}`; steps from `t.genStep1..4`. Per-step vals with `done = genStep > i`, `active = genStep === i` (i = 0..3):
- `mark`: `'✓'` if done else `i+1`
- `bg`: done `#E9F6EF`, active `#E8F5F6`, upcoming `#F0F3F8`
- `fg`: done `#1F7A4D`, active `#0E7A81`, upcoming `#93A1B8`
- `opacity`: `1` if done/active else `0.45`

---

## 5. Brief page (`cPage:'brief'`)

Content from `BRIEF` in talaqi-data.js (title, summary, objective, 6 scope items numbered `n:i+1`, 4 deliverables, 5 skills, budget `"4,000 – 8,000"` + unit, timeline, complexity label + `complexityPct: 55` → bar width `'55%'`, 2 "missing info" questions, provider type, 4 criteria, 4 milestones with `line: i < last` connector flag).

**Edit mode:** `toggleEdit` flips `editing`. Button label `editBtnLabel` = `t.briefSaveEdit` when editing, else `'✎ ' + t.briefEdit`. Three editable fields (title / summary / budget): view shows `edits.x != null ? edits.x : BRIEF.x(lang)` (`briefTitleView`, `briefSummaryView`, `briefBudgetView`); edit inputs write via `onEditTitle/onEditSummary/onEditBudget` into `edits` (shallow merge). Template uses paired `sc-if {{ editing }}` / `{{ notEditing }}` blocks (3 each).

**Approve:** `approveBrief` → `setState({ editing:false, cPage:'matches', briefReady:true })` + instant scrollTop + toast `t.briefApprovedToast`. (Idempotent; also sets `briefReady` if the user navigated here without generating.)

---

## 6. Matches, Provider, Admin interaction states

### 6.1 Client Matches (`cPage:'matches'`)
Cards from `MATCHES` (6 entries `{pid, score, reasonAr/En}`) joined to `PROVIDERS` by `pid`. Card vals: localized name/type/role/city, `rating`, `years`, `price` = `min.toLocaleString() + '–' + max.toLocaleString()`, `init`, `color`, `verified` (`sc-if {{ mc.verified }}` badge), `score`, `scoreColor` = `#0E7A81` if ≥85, `#8A6D33` if ≥78, else `#7684A0`, `reason`, `skillList`.
**Request proposal:** `requested = !!proposals[pid]`; `sc-if {{ mc.notRequested }}` shows the request button → sets `proposals[pid] = true` + toast `t.proposalSent`; `sc-if {{ mc.requested }}` shows the "sent" state. **Irreversible** in the demo.

### 6.2 Client Project Detail (`cPage:'detail'`)
Always renders `PROJECTS[0]` (perfume store): `detailCat`, `detailDate`, status hardcoded to `statusMap.matched` (`detailStLabel/Bg/Fg`). `requestedProviders` = `MATCHES.filter(m => proposals[m.pid])` mapped to `{name, init, color, score}`; `hasRequested`/`noRequested` gate the list vs. empty state.
**5-step tracker** (`pdStepItems` from `t.pdSteps`, 5 labels): `curStep = requestedProviders.length > 0 ? 3 : 2`. Per step i: `done = i < curStep`, `active = i === curStep`; `mark` `'✓'`/`i+1`; `bg` done `#14969E`, active `#1B3568`, else `#fff`; `fg` `#fff` if done|active else `#93A1B8`; `border` `none` if done|active else `2px solid #E4E9F1`; `labelColor` `#14213A` / `#93A1B8`; `w` 700 active else 500; connector `line: i < 4` with `lineColor` `#14969E` if `i < curStep` else `#EEF1F6`; `flex` `'1'` for i<4 else `'0 0 auto'`. Activity feed `pdActivityItems` from `t.pdActivity` with `line` connector on all but last.

### 6.3 Provider Home (`pPage:'home'`)
Stats: `t.pStatOps:'3'` teal, `t.pStatActive:'2'` navy, `t.pStatRating:'4.9 ★'` `#8A6D33`, `t.pStatResponse:'92%'` navy. Opportunity cards from `OPPORTUNITIES` (3): state `ops[id]` → `isPending` (no key) / `isAccepted` (`'a'`) / `isDeclined` (`'d'`), each an `sc-if` branch. `accept` → `ops[id]='a'` + toast `t.accepted`; `decline` → `ops[id]='d'` (no toast). `scoreColor` = `#0E7A81` if score ≥85 else `#8A6D33`. Irreversible.

### 6.4 Provider Requests (`pPage:'requests'`)
Cards from `REQUESTS` (3, with `when` + `note`): `reqs[id]` → `isPending`/`isSent` (`'s'`)/`isDeclined` (`'d'`). `send` → `'s'` + toast `t.reqSentLbl`; `decline` → `'d'`. Irreversible.

### 6.5 Provider Profile (`pPage:'profile'`)
Static from `PROVIDERS[0]`: name/role; facts list (`t.pfType/pfCity/pfYears/pfLangs/pfPrice/pfAvail`), price = `'4,000 – 9,000'` via toLocaleString join with ` – `; skills = `PROVIDERS[0].skills` + `['Shipping APIs','Speed Optimization']`; services `t.servicesItems`; portfolio `t.portfolioItems`.

### 6.6 Admin Overview (`aPage:'overview'`)
- `adminStats1`: users 1,284 / clients 942 / providers 326 / projects 418 (toLocaleString).
- `adminStats2` (colored tiles): weekly 37 (`bg:#fff bd:#E4E9F1 lc:#7684A0 vc:#1B3568`), briefs 389 (`#E8F5F6/#C6E7E9/#0E7A81/#0E7A81`), pending 12 (`#FDF9F0/#EFE2C6/#8A6D33/#8A6D33`), matchRate `'87%'` (`#EEF3FB/#D5DDE9/#1B3568/#1B3568`).
- `chartBars`: `ADMIN.topCats` (6), `pct = round(v/max*100)+'%'`, colors cycle `[#14969E, #1B3568, #C6A15B]` ×2.
- `pendingCards`: `ADMIN.pendingProviders` (4), keyed by index; `pending[i]` → `isPending`/`isApproved` (`'a'`)/`isRejected` (`'r'`); `approve`/`reject` set the flag — **no toast**. Irreversible.

### 6.7 Admin Providers (`aPage:'providers'`)
Table rows from all 16 `PROVIDERS`: name/role/type/city/rating/init/color/price + verified chip: `vLabel` `t.verified`/`t.unverified`, `vBg` `#E9F6EF`/`#F0F3F8`, `vFg` `#1F7A4D`/`#93A1B8`.

### 6.8 Admin Users (`aPage:'users'`)
Rows from `USERS` (10). Role chip map: client `{t.roleClient, bg:#EEF3FB, fg:#1B3568, avatarColor:#1B3568}`, provider `{t.roleProvider, #E8F5F6, #0E7A81, avatar #14969E}`, admin `{t.roleAdminL, #F7F0E3, #8A6D33, avatar #14213A}`. `init` = first char of localized name. Status chip: active → `t.activeL`, `#E9F6EF`/`#1F7A4D`; suspended → `t.suspendedL`, `#FBEDEB`/`#B0433A`.

### 6.9 Admin Briefs (`aPage:'briefs'`)
Rows from `BRIEFS_LIST` (5): quality `q` shown as `q + '%'`, `qColor` `#0E7A81` if ≥90 else `#8A6D33`; status chip approved → `t.approvedTag` `#E9F6EF`/`#1F7A4D`, pending → `t.pendingTag` `#FDF9F0`/`#8A6D33`. Expand: `isOpen = briefOpen === i`; button label `t.closeBtn` / `t.reviewBtn`; **only row 0 toggles** (`briefOpen: isOpen ? null : 0`); rows 1–4 → toast `t.demoOnly`. `sc-if {{ b.isOpen }}` shows the review panel.

### 6.10 Admin Analytics (`aPage:'analytics'`)
From `ANALYTICS`: `anAvg:86`, `anAccept:74`, `anTime` `'3.2 دقيقة'|'3.2 min'`. Distribution bars (`anDist`, 4 rows): `pct = round(v/max*100)+'%'`, colors `[#14969E, #1B3568, #C6A15B, #93A1B8]`. Weekly bars (`anWeekly`, 7 values `[6,9,5,11,8,3,4]`): height = `max(12, round(v/max*120)) + 'px'` (max bar 120px, floor 12px), color `#1B3568` for the max value else `#8ED4D9`. Revenue: `revMrr:'48,500'`, `revSubs:'214'`, `revGrowth:'+18%'`.

### 6.11 Admin Cats (`aPage:'cats'`) / skills
`skillChips` = `SKILLS` map `{n, c}` (name + localized category). `cats` (landing) = `CATEGORIES` (16) `{name, count}`.

---

## 7. Language toggle & persistence

- Header toggle: `toggleLang` → `setState({ lang: ar ? 'en' : 'ar' })`.
- Settings page: `setAr`/`setEn` set explicitly. Segmented control styles: active side `bg:#fff`, `fg:#1B3568`, `shadow:'0 2px 6px rgba(20,40,80,.12)'`; inactive `transparent`/`#7684A0`/`none` (vals `arBg/arFg/arShadow`, `enBg/enFg/enShadow`).
- Direction vals: `dir` = `'rtl'`|`'ltr'`, `dirOpp` = opposite, `arrowChar` = `'←'` (ar) / `'→'` (en). `cpFacts` email/phone/langs rows force `dir:'ltr'`.
- **No persistence whatsoever** — no localStorage/cookies; refresh resets to Arabic. If the rebuild adds persistence, that is an enhancement, not fidelity. Recommended for Next.js: `<html lang dir>` swap + i18n dictionary equivalent to `I18N.ar`/`I18N.en` (all keys enumerated in talaqi-data.js lines 235–633; renderVals-consumed keys listed throughout this spec).
- Language switching **re-localizes existing data instantly** (all lists recompute), but **already-pushed chat messages keep the language they were sent in** (stored as strings).

### 7.1 Settings page (shared, `isSettings`)
Language segmented control (above); 3 notification toggle switches: track `bg` `#14969E` on / `#D5DDE9` off, knob inset `knob` = `'22px'` on / `'3px'` off (logical offset), `toggle` flips `notif[i]`; other actions use `demoToast` (`t.demoOnly`).

### 7.2 Signup page (`pubPage:'signup'`)
`suIsClient`/`suIsProvider` gate role-specific fields. Role cards: client selected `bg:#EEF3FB bd:#1B3568`, provider selected `bg:#E8F5F6 bd:#0E7A81`, unselected `#fff`/`#E4E9F1`. `suBtnBg` = `#0E7A81` provider / `#1B3568` client. `suOrgLabel = t.sfCompany`. `suSubmit` → `{ view:'app', role: signupRole, cPage:'home', pPage:'home' }` + scrollTop + toast `t.signupToast`. Login page: `demoToast` on submit; `contactSend` on contact page → toast `t.contactSentToast`.

### 7.3 Pricing plans (landing)
`plans` from `t.plans` (4). Per plan: `hot` flag (highlighted plan) → `bg:'linear-gradient(160deg, #1B3568, #0F5E64)'`, `fg:#fff`, `border:'1px solid transparent'`, check icon `#7FE3E9`, button `bg:#fff`; non-hot: `bg:#fff`, `fg:#1A2438`, `border:'1px solid #E4E9F1'`, check `#14969E`, button `bg:#F0F3F8`; all buttons `fg:#1B3568`, `border:none`. CTA `go`: plan index 3 → signup as provider, else as client.

### 7.4 Client home stats & project rows
Stats: `t.statActive:'3'` navy, `t.statBriefsDone: briefReady ? '5' : '4'` teal, `t.statProposals:'7'` navy, `t.statSaved:'26+'` `#8A6D33`. Project rows from `PROJECTS` (5) with status chip from `statusMap`:

| status | label key | bg | fg |
|---|---|---|---|
| draft | `t.stDraft` | `#F0F3F8` | `#7684A0` |
| brief | `t.stBrief` | `#EEF3FB` | `#1B3568` |
| matched | `t.stMatched` | `#E8F5F6` | `#0E7A81` |
| selected | `t.stSelected` | `#F7F0E3` | `#8A6D33` |
| inprogress | `t.stInprogress` | `#FDF9F0` | `#8A6D33` |
| completed | `t.stCompleted` | `#E9F6EF` | `#1F7A4D` |

### 7.5 Landing computed lists
`pipeSteps` = `t.pipe1..pipe5` with `n:i+1`, `arrow: i<4`; `problems`/`clientVals`/`providerVals` = string lists wrapped `{text}`; `howSteps` = `t.how` with tile palette `[{#EEF3FB,#1B3568},{#E8F5F6,#0E7A81},{#F7F0E3,#8A6D33},{#E8F5F6,#0E7A81},{#EEF3FB,#1B3568}]`; `features` = `t.features` with dot colors cycling `[#14969E,#1B3568,#C6A15B]`; hero: `briefTitle`, `heroTimeline` from `BRIEF`, `heroMatchName/Role` from `PROVIDERS[0]`. Public pages: `aboutVals` (`t.aboutVals`), `fcBenefits`, `fpBenefits`, `fpSteps` (numbered).

---

## 8. Brand constants (used inline everywhere)

`NAVY = #1B3568`, `TEAL = #14969E`, gold accent `#C6A15B`; muted text `#7684A0`, body text `#2C3A54`/`#3D4C68`/`#4A5A76`, dark `#14213A`, faint `#93A1B8`; borders `#E4E9F1`, `#EEF1F6`, `#C9D3E2`, `#D5DDE9`; tints navy `#EEF3FB`, teal `#E8F5F6`, gold `#F7F0E3`/`#FDF9F0`, green `#E9F6EF` (fg `#1F7A4D`), red `#FBEDEB` (fg `#B0433A`), neutral `#F0F3F8`; teal-dark fg `#0E7A81`, gold fg `#8A6D33`; light teal bar `#8ED4D9`, check-on-dark `#7FE3E9`; hot-plan gradient `linear-gradient(160deg, #1B3568, #0F5E64)`; active-pill shadow `0 2px 6px rgba(20,40,80,.12)`.

---

## 9. Runtime semantics to replicate (from support.js)

These are dc-runtime behaviors the templates rely on; the Next.js port must produce equivalent results:

1. **`{{ expr }}` resolution** supports: dotted/bracket paths, literals (`true/false/null/undefined`, numbers, quoted strings), unary `!`, and top-level `===`, `!==`, `==`, `!=`. Attribute values that are a single whole `{{ }}` pass the raw value (functions for event handlers, objects for `style`); mixed text interpolates with `?? ''`.
2. **`sc-if value="{{ cond }}"`** renders children iff truthy → conditional JSX. **`sc-for list="{{ arr }}" as="x"`** → `.map()` with `$index` available.
3. **`style-hover="css"`** (and any `style-<pseudo>`) compiles to a generated class with `.cls:hover{css}` — port to Tailwind `hover:` utilities or CSS. `style="a:b;c:d"` strings become style objects (kebab→camel).
4. **Event attributes** are lowercase (`onclick=`, `oninput=`, `onkeydown=`) mapped to React handlers.
5. Controlled inputs: `value`/`checked` resolving to `undefined` coerce to `''`/`false` (avoids uncontrolled warnings).
6. Interpolated text renders inside `<span class="sc-interp">`; unresolved values render empty (dev warning). Not needed in the rebuild beyond "missing key ⇒ empty string" (the `t()` Proxy already guarantees this pre-data-load).
7. State updates are shallow merges over a single state object with functional-update support — mirror ordering when porting compound handlers (e.g., `goSignupC` does two sequential setStates).
8. Timers (`_toastTimer`, `_genTimer`, chat `setTimeout`s) are **not** cleaned up on unmount in the prototype; the rebuild should clear them in effect cleanups but keep the same durations: **60 ms** chat scroll, **200 ms** anchor-scroll after page switch, **850 ms** per generation tick (×5 = 4,250 ms total), **1000 ms** scripted answer delay, **1100 ms** first scripted reply delay, **2600 ms** toast.
9. Arabic default with `dir="rtl"` on the root; all layout uses CSS logical properties in the template — keep `dir`-driven flipping (`dir`, `dirOpp`, `arrowChar`, `toastShift` vals) rather than hardcoding sides.

---

## 10. Data contracts (talaqi-data.js summary)

- `CATEGORIES` (16): `{id, ar, en, count}`.
- `PROVIDERS` (16): `{id, ar, en, typeAr/En, roleAr/En, cityAr/En, skills[], rating, min, max, years, availAr/En, langs, verified, color, init}`.
- `MATCHES` (6): `{pid, score, reasonAr/En}` — pids 1–6, scores 94/91/88/84/79/76.
- `PROJECTS` (5): `{id, titleAr/En, catAr/En, status, budget, timelineAr/En, date}` — statuses: matched, completed, inprogress, draft, brief.
- `OPPORTUNITIES` (3): `{id, titleAr/En, score(94/87/81), budget, timelineAr/En, skills[], clientAr/En, noteAr/En}`.
- `ADMIN`: `{users:1284, clients:942, providers:326, projects:418, weekly:37, briefs:389, pending:12, matchRate:87, topCats[6], pendingProviders[4]}`.
- `CHAT_SCRIPT` (5): `{qAr, qEn, chips:[{ar,en}]}` — perfume-store interview (products/quantity → brand identity → payments/shipping → budget → launch date).
- `CHAT_DONE`: `{ar, en}` completion message.
- `BRIEF`: full brief object (see §5) — `complexityPct: 55`, budget `"4,000 – 8,000"`, 4 milestones.
- `USERS` (10), `REQUESTS` (3), `BRIEFS_LIST` (5), `ANALYTICS` (`avg:86, accept:74, dist[4], weekly[7], rev`), `SKILLS` (chips), `I18N` = `{ar: {...}, en: {...}}` full dictionaries (lines 235–633).
