# Provider & Admin Screens — Implementation Spec

Source: `Talaqi Platform.dc.html` lines 1046–2184 + `talaqi-data.js`.
Target: Next.js 15 + TypeScript + Tailwind. Arabic default, `dir="rtl"`; all inline styles below use CSS **logical** properties where directionality matters (`inset-inline-start`, `padding-inline`, `text-align: start`). Everything else is direction-neutral.

## Conventions used in this spec

- `{{ t.key }}` → i18n lookup from `I18N[lang]` (lang = `'ar' | 'en'`, default `'ar'`).
- `{{ handler }}` → callback computed in `renderVals()` (documented per screen).
- `<sc-if value="{{ cond }}">` → conditional render.
- `<sc-for list="{{ arr }}" as="x">` → map render.
- `style-hover="..."` → styles applied on `:hover` (implement via Tailwind `hover:` or CSS).
- Palette constants: `NAVY = #1B3568`, `TEAL = #14969E`. Recurring tokens:
  - Card surface: `background:#fff; border:1px solid #E4E9F1`
  - Muted text: `#7684A0`; faint text: `#93A1B8`; body text: `#2C3A54`; table cell text: `#4A5A76`
  - Success chip: bg `#E9F6EF` / fg `#1F7A4D`; danger chip: bg `#FBEDEB` / fg `#B0433A`
  - Teal chip: bg `#E8F5F6` / fg `#0E7A81`; navy chip: bg `#EEF3FB` / fg `#1B3568`
  - Gold: fg `#8A6D33`, bg `#FDF9F0` (note) / `#F7F0E3` (card), border `#EFE2C6`
  - Table header row bg `#FAFBFD`, header border-bottom `#EEF1F6`, row border-bottom `#F3F5F9`
  - Track bg for progress bars: `#F0F3F8` (9px/6px) or `#EEF1F6` (7px)

## Routing / visibility conditions (from `renderVals()`)

State: `view ('landing'|'app')`, `role ('client'|'provider'|'admin')`, `pPage`, `aPage`, `cPage`.

| Screen | Condition |
|---|---|
| Provider dashboard | `isProviderHome` = `view==='app' && role==='provider' && pPage==='home'` |
| Provider profile | `isProviderProfile` = `... && pPage==='profile'` |
| Proposal requests | `isProviderRequests` = `... && pPage==='requests'` |
| Admin overview | `isAdminOverview` = `role==='admin' && aPage==='overview'` |
| Admin providers | `isAdminProviders` = `aPage==='providers'` |
| Admin projects | `isAdminProjects` = `aPage==='projects'` |
| Admin users | `isAdminUsers` = `aPage==='users'` |
| Admin briefs review | `isAdminBriefs` = `aPage==='briefs'` |
| Admin analytics | `isAdminAnalytics` = `aPage==='analytics'` |
| Admin categories | `isAdminCats` = `aPage==='cats'` |
| Settings (shared) | `isSettings` = `(role==='client' && cPage==='settings') || (role==='provider' && pPage==='settings') || (role==='admin' && aPage==='settings')` |

Sidebar nav (in shell, for reference — items via `navItem(label, active, go, badge)`):
- Provider nav: `t.pNavHome` (badge `'3'`), `t.pNavRequests` (badge `'2'`), `t.pNavProfile`, `t.pNavSettings`.
- Admin nav: `t.aNavOverview`, `t.aNavUsers`, `t.aNavProviders` (badge `'12'`), `t.aNavProjects`, `t.aNavBriefs`, `t.aNavAnalytics`, `t.aNavCats`, `t.aNavSettings`.
- navItem visuals: active → `bg:#EEF3FB; fg:#1B3568; font-weight:700; dot color #14969E, dot border-radius 2px`; inactive → `bg:transparent; fg:#4A5A76; weight 500; dot #C9D3E2, radius 50%`.
- Shell avatar per role: admin `#14213A` init `م`, provider `#14969E` init `ع`, client `#1B3568` init `أ`. Sidebar title for provider = provider #1 name (`PROVIDERS[0].ar/en`), for admin = `'إدارة المنصة'` / `'Platform admin'`.

Every nav `go` handler also does `window.scrollTo({ top: 0 })`.

Interaction state persisted in component state (survives navigation within session):
- `ops: {}` — opportunity id → `'a'` (accepted) | `'d'` (declined)
- `reqs: {}` — request id → `'s'` (sent) | `'d'` (declined)
- `pending: {}` — pending-provider index → `'a'` (approved) | `'r'` (rejected)
- `briefOpen: null | 0` — which brief row is expanded (only row 0 can open)
- `notif: {0:true, 1:true, 2:false}` — notification toggles
- `toast: null | string` — toast message, auto-cleared after **2600ms**

`showToast(msg)`: sets toast, `clearTimeout` previous, clears after 2600ms.

---

## 1. Provider dashboard / opportunities (`isProviderHome`)

Wrapper: `<div data-screen-label="Provider dashboard" style="max-width: 1000px; margin: 0 auto;">`

### 1.1 Header
- Block `margin-bottom: 22px`
  - `<h1>` `{{ t.providerWelcome }}` — `font-size:24px; font-weight:700; margin:0 0 4px`
  - `<p>` `{{ t.providerWelcomeSub }}` — `color:#7684A0; margin:0; font-size:14.5px`

### 1.2 Stats grid (`providerStats`, 4 items)
- Grid: `display:grid; grid-template-columns: repeat(4,1fr); gap:16px; margin-bottom:28px`
- Each card: `background:#fff; border:1px solid #E4E9F1; border-radius:16px; padding:20px`
  - Label: `font-size:13px; color:#7684A0; margin-bottom:6px` → `{{ s.label }}`
  - Value: `font-size:27px; font-weight:700; color:{{ s.color }}` → `{{ s.v }}`
- Data (computed):
  1. `{ label: t.pStatOps, v: '3', color: '#14969E' }`
  2. `{ label: t.pStatActive, v: '2', color: '#1B3568' }`
  3. `{ label: t.pStatRating, v: '4.9 ★', color: '#8A6D33' }`
  4. `{ label: t.pStatResponse, v: '92%', color: '#1B3568' }`

### 1.3 Section header
- Block `margin-bottom:16px`: `<h2>` `{{ t.opsTitle }}` (`font-size:18px; font-weight:700; margin:0 0 3px`), `<p>` `{{ t.opsSub }}` (`color:#7684A0; margin:0; font-size:13.5px`)

### 1.4 Opportunity cards (`opCards` from `OPPORTUNITIES`, 3 items)
Column stack: `display:flex; flex-direction:column; gap:16px`

Each card: `background:#fff; border:1px solid #E4E9F1; border-radius:18px; padding:22px 24px; display:grid; grid-template-columns: auto 1fr auto; gap:20px; align-items:center`

**Column 1 — match score** (`text-align:center; min-width:64px`):
- Score: `font-size:23px; font-weight:700; color:{{ op.scoreColor }}` → `{{ op.score }}%`
  - `scoreColor = score >= 85 ? '#0E7A81' : '#8A6D33'`
- Caption `{{ t.matchScore }}`: `font-size:11px; color:#93A1B8`

**Column 2 — body** (`min-width:0`):
- Title `{{ op.title }}`: `font-size:16px; font-weight:700; margin-bottom:3px`
- Meta line: `font-size:13px; color:#7684A0; margin-bottom:10px` — text: `{{ t.clientLabel }}: {{ op.client }} · {{ t.budgetLabel }}: {{ op.budget }} {{ t.perProject }} · {{ t.timelineLabel }}: {{ op.timeline }}`
- Skill chips row: `display:flex; flex-wrap:wrap; gap:6px; margin-bottom:10px`; each chip (`op.skillList` from `o.skills`): `background:#EEF3FB; color:#1B3568; font-size:12px; font-weight:600; padding:3px 11px; border-radius:999px`
- Note callout: `font-size:13px; color:#6E5A31; background:#FDF9F0; border-radius:8px; padding:8px 13px; display:inline-block` — content: `ⓘ {{ op.note }}` (literal `ⓘ` + space prefix)

**Column 3 — actions** (`display:flex; flex-direction:column; gap:9px; min-width:130px`), three mutually exclusive states from `ops[o.id]`:
- `isPending` (`!st`, default true):
  - Accept button `onClick={{ op.accept }}`: `background:#0E7A81; color:#fff; border:none; cursor:pointer; font-size:13.5px; font-weight:700; padding:11px 18px; border-radius:10px`; hover: `background:#14969E`. Label `{{ t.accept }}`.
  - Decline button `onClick={{ op.decline }}`: `background:#fff; color:#7684A0; border:1.5px solid #E4E9F1; cursor:pointer; font-size:13.5px; font-weight:600; padding:10px 18px; border-radius:10px`; hover: `border-color:#B0433A; color:#B0433A`. Label `{{ t.decline }}`.
- `isAccepted` (`st === 'a'`): static badge `{{ t.accepted }}` — `background:#E9F6EF; color:#1F7A4D; font-size:13px; font-weight:700; padding:11px 18px; border-radius:10px; text-align:center`
- `isDeclined` (`st === 'd'`): static badge `{{ t.declined }}` — `background:#F0F3F8; color:#93A1B8; font-size:13px; font-weight:700; padding:11px 18px; border-radius:10px; text-align:center`

Handlers:
- `op.accept` = set `ops[o.id] = 'a'` **and** `showToast(t.accepted)`
- `op.decline` = set `ops[o.id] = 'd'` (no toast)
- State persists across page switches (kept in shared state / context).

Opportunity data (`OPPORTUNITIES`): 3 items — Perfume e-commerce store (score 94, budget "4,000–8,000", 3–5 weeks, skills Shopify/Payment Integration/UI-UX, client Oud Al-Khaleej Co.), Specialty coffee gear store (87, "6,000–11,000", 4 weeks, WooCommerce/Shipping APIs, Morning Cup Est.), Migration to Shopify Plus (81, "15,000–25,000", 8 weeks, Shopify Plus/Data Migration, Dar Al-Anaqa Fashion). All fields have Ar/En variants; `note` per item.

i18n keys used: `providerWelcome, providerWelcomeSub, pStatOps, pStatActive, pStatRating, pStatResponse, opsTitle, opsSub, matchScore, clientLabel, budgetLabel, perProject, timelineLabel, accept, decline, accepted, declined`.

---

## 2. Provider profile (`isProviderProfile`)

Wrapper: `<div data-screen-label="Provider profile" style="max-width: 900px; margin: 0 auto;">`

### 2.1 Header row
`display:flex; align-items:flex-end; justify-content:space-between; gap:16px; margin-bottom:22px; flex-wrap:wrap`
- Left: `<h1>` `{{ t.profileTitle }}` (`24px/700; margin:0 0 4px`) + `<p>` `{{ t.profileSub }}` (`#7684A0; 14.5px; margin:0`)
- Right — profile completion card: `background:#fff; border:1px solid #E4E9F1; border-radius:14px; padding:12px 20px; min-width:220px`
  - Label row: `display:flex; justify-content:space-between; font-size:12.5px; margin-bottom:6px` — `<span style="color:#7684A0">{{ t.profileCompletion }}</span>` + `<span style="font-weight:700; color:#0E7A81">85%</span>` (hardcoded 85%)
  - Track: `height:7px; background:#EEF1F6; border-radius:999px; overflow:hidden`; fill: `height:100%; width:85%; background:linear-gradient(90deg, #14969E, #1B3568); border-radius:999px`

### 2.2 Identity card
`background:#fff; border:1px solid #E4E9F1; border-radius:18px; padding:26px; margin-bottom:18px; display:flex; gap:20px; align-items:center; flex-wrap:wrap`
- Avatar: `width:72px; height:72px; border-radius:20px; background:#1B3568; color:#fff; font-size:30px; font-weight:700; display:flex; align-items:center; justify-content:center` — content literal `ع`
- Right block (`flex:1; min-width:220px`):
  - Row `display:flex; align-items:center; gap:10px; flex-wrap:wrap`:
    - Name `{{ profileName }}` (`font-size:19px; font-weight:700`) — from `PROVIDERS[0]` (Abdullah Al-Shammari / عبدالله الشمري)
    - Verified badge `{{ t.verifiedBadge }}`: `background:#E9F6EF; color:#1F7A4D; font-size:12px; font-weight:600; padding:3px 12px; border-radius:999px`
  - Subtitle: `font-size:14px; color:#7684A0` — `{{ profileRole }} · ★ 4.9` (role = PROVIDERS[0].roleAr/En, rating literal)

### 2.3 Facts grid (`profileFacts`, 6 items)
`display:grid; grid-template-columns: repeat(3,1fr); gap:14px; margin-bottom:18px`
Each: `background:#fff; border:1px solid #E4E9F1; border-radius:14px; padding:16px 18px`
- Label: `font-size:12px; color:#93A1B8; margin-bottom:3px` → `{{ f.label }}`
- Value: `font-size:15px; font-weight:700; color:#2C3A54` → `{{ f.v }}`
- Data from `PROVIDERS[0]`: `{t.pfType, typeAr/En ("مستقل"/"Freelancer")}`, `{t.pfCity, "الرياض"/"Riyadh"}`, `{t.pfYears, 7}`, `{t.pfLangs, "AR / EN"}`, `{t.pfPrice, "4,000 – 9,000"}` (min/max `.toLocaleString()` joined with ` – `), `{t.pfAvail, availAr/En ("متاح الآن"/"Available now")}`

### 2.4 Two-column panels
`display:grid; grid-template-columns: 1fr 1fr; gap:18px`

**Left panel — skills + services** (`background:#fff; border:1px solid #E4E9F1; border-radius:18px; padding:24px`):
- Header row: `display:flex; justify-content:space-between; align-items:center; margin-bottom:14px`
  - Title `{{ t.pfSkills }}` (`15px/700`)
  - Add-skill button `{{ t.addSkill }}`: `background:#F0F3F8; border:none; cursor:pointer; color:#1B3568; font-size:12.5px; font-weight:600; padding:5px 13px; border-radius:999px` (no onClick — decorative in prototype)
- Skill chips (`profileSkills` = `PROVIDERS[0].skills` + `['Shipping APIs','Speed Optimization']` → 6 chips: Shopify, WooCommerce, Payment Integration, UI/UX, Shipping APIs, Speed Optimization): container `display:flex; flex-wrap:wrap; gap:7px; margin-bottom:22px`; chip: `background:#EEF3FB; color:#1B3568; font-size:13px; font-weight:600; padding:6px 14px; border-radius:999px`
- Services title `{{ t.pfServices }}`: `font-size:15px; font-weight:700; margin-bottom:12px`
- Services list (`profileServices` = `t.servicesItems`): `display:flex; flex-direction:column; gap:9px`; row: `display:flex; gap:10px; align-items:center; font-size:14px; color:#2C3A54` with a diamond bullet: `<span style="width:7px; height:7px; border-radius:2px; background:#14969E; transform:rotate(45deg); flex-shrink:0;"></span>` then `{{ sv.text }}`

**Right panel — portfolio** (`same card style, padding:24px`):
- Title `{{ t.pfPortfolio }}`: `15px/700; margin-bottom:14px`
- Items (`profilePortfolio` = `t.portfolioItems`): stack `gap:12px`; each item: `border:1px solid #E4E9F1; border-radius:12px; padding:14px 16px; display:flex; gap:12px; align-items:center`; hover: `border-color:#14969E`
  - Thumb: `width:44px; height:44px; border-radius:10px; background: repeating-linear-gradient(45deg, #EEF3FB, #EEF3FB 6px, #E1E9F6 6px, #E1E9F6 12px); flex-shrink:0`
  - Text `{{ pf.text }}`: `font-size:13.5px; font-weight:600; color:#2C3A54`

i18n keys: `profileTitle, profileSub, profileCompletion, verifiedBadge, pfType, pfCity, pfYears, pfLangs, pfPrice, pfAvail, pfSkills, addSkill, pfServices, servicesItems (array), pfPortfolio, portfolioItems (array)`.

---

## 3. Proposal requests (`isProviderRequests`)

Wrapper: `<div data-screen-label="Proposal requests" style="max-width: 1000px; margin: 0 auto;">`

### 3.1 Header (`margin-bottom:20px`)
- `<h1>` `{{ t.requestsTitle }}` (`24px/700; margin:0 0 4px`) + `<p>` `{{ t.requestsSub }}` (`#7684A0; 14.5px; margin:0`)

### 3.2 Request cards (`reqCards` from `REQUESTS`, 3 items)
Stack: `display:flex; flex-direction:column; gap:16px`
Card: `background:#fff; border:1px solid #E4E9F1; border-radius:18px; padding:22px 24px; display:grid; grid-template-columns: 1fr auto; gap:20px; align-items:center`

**Left column** (`min-width:0`):
- Title row: `display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:4px`
  - Title `{{ rq.title }}`: `font-size:16px; font-weight:700`
  - Received chip: `background:#E8F5F6; color:#0E7A81; font-size:11.5px; font-weight:700; padding:2px 11px; border-radius:999px; white-space:nowrap` — text `{{ t.reqReceived }} {{ rq.when }}` (e.g. "10 minutes ago" / "قبل 10 دقائق")
- Meta: `font-size:13px; color:#7684A0; margin-bottom:10px` — `{{ t.clientLabel }}: {{ rq.client }} · {{ t.budgetLabel }}: {{ rq.budget }} {{ t.perProject }} · {{ t.timelineLabel }}: {{ rq.timeline }}`
- Note callout (same as opportunities): `font-size:13px; color:#6E5A31; background:#FDF9F0; border-radius:8px; padding:8px 13px; display:inline-block` — `ⓘ {{ rq.note }}`

**Right column — actions** (`display:flex; flex-direction:column; gap:9px; min-width:140px`), state from `reqs[r.id]`:
- `isPending` (`!st`):
  - Send button `onClick={{ rq.send }}`: `background:#1B3568; color:#fff; border:none; cursor:pointer; font-size:13.5px; font-weight:700; padding:11px 18px; border-radius:10px`; hover: `background:#24437F`. Label `{{ t.reqSend }}`.
  - Decline button `onClick={{ rq.decline }}`: identical to opportunity decline — `background:#fff; color:#7684A0; border:1.5px solid #E4E9F1; font-size:13.5px; font-weight:600; padding:10px 18px; border-radius:10px`; hover `border-color:#B0433A; color:#B0433A`. Label `{{ t.decline }}`.
- `isSent` (`st === 's'`): badge `{{ t.reqSentLbl }}` — `background:#E9F6EF; color:#1F7A4D; font-size:13px; font-weight:700; padding:11px 18px; border-radius:10px; text-align:center`
- `isDeclined` (`st === 'd'`): badge `{{ t.declined }}` — `background:#F0F3F8; color:#93A1B8;` (same style as sent badge otherwise)

Handlers: `rq.send` sets `reqs[r.id]='s'` and `showToast(t.reqSentLbl)`; `rq.decline` sets `reqs[r.id]='d'` (no toast). Persist state.

Data (`REQUESTS`): (1) Perfume e-commerce store — Oud Al-Khaleej Co., 4,000–8,000, 3–5 weeks, when "10 minutes ago"/"قبل 10 دقائق"; (2) Specialty coffee gear store — Morning Cup Est., 6,000–11,000, 4 weeks, "3 hours ago"/"قبل 3 ساعات"; (3) Fashion store revamp — Dar Al-Anaqa Fashion, 15,000–25,000, 8 weeks, "Yesterday"/"أمس". Each with Ar/En `note`.

i18n keys: `requestsTitle, requestsSub, reqReceived, clientLabel, budgetLabel, perProject, timelineLabel, reqSend, decline, reqSentLbl, declined`.

---

## 4. Admin overview (`isAdminOverview`)

Wrapper: `<div data-screen-label="Admin overview" style="max-width: 1040px; margin: 0 auto;">`

### 4.1 Header (`margin-bottom:22px`)
- `<h1>` `{{ t.adminTitle }}` (`24px/700; margin:0 0 4px`) + `<p>` `{{ t.adminSub }}` (`#7684A0; 13.5px; margin:0`) — note: sub is 13.5px here (not 14.5).

### 4.2 Stats row 1 (`adminStats1`, 4 cards)
`display:grid; grid-template-columns:repeat(4,1fr); gap:16px; margin-bottom:16px`
Card: `background:#fff; border:1px solid #E4E9F1; border-radius:16px; padding:20px`
- Label `{{ s.label }}`: `13px; #7684A0; margin-bottom:6px`
- Value `{{ s.v }}`: `font-size:27px; font-weight:700; color:#1B3568` (fixed navy)
- Growth line `{{ t.monthGrowth }}`: `font-size:11.5px; color:#2FA36B; margin-top:3px`
- Data from `ADMIN` (values via `.toLocaleString()`): `{t.aUsers, 1,284}`, `{t.aClients, 942}`, `{t.aProviders, 326}`, `{t.aProjects, 418}`

### 4.3 Stats row 2 (`adminStats2`, 4 tinted cards)
`grid repeat(4,1fr); gap:16px; margin-bottom:26px`
Card: `background:{{ s.bg }}; border:1px solid {{ s.bd }}; border-radius:16px; padding:20px`; label `13px; color:{{ s.lc }}; margin-bottom:6px`; value `27px/700; color:{{ s.vc }}`. No growth line.
1. `{ label: t.aWeekly, v: 37, bg:'#fff', bd:'#E4E9F1', lc:'#7684A0', vc:'#1B3568' }`
2. `{ label: t.aBriefs, v: 389, bg:'#E8F5F6', bd:'#C6E7E9', lc:'#0E7A81', vc:'#0E7A81' }`
3. `{ label: t.aPending, v: 12, bg:'#FDF9F0', bd:'#EFE2C6', lc:'#8A6D33', vc:'#8A6D33' }`
4. `{ label: t.aMatchRate, v: '87%', bg:'#EEF3FB', bd:'#D5DDE9', lc:'#1B3568', vc:'#1B3568' }`

### 4.4 Two-panel row
`display:grid; grid-template-columns: 1.2fr 1fr; gap:18px`

**Left — top categories chart** (`background:#fff; border:1px solid #E4E9F1; border-radius:18px; padding:24px`):
- Title `{{ t.aTopCats }}`: `15px/700; margin-bottom:18px`
- Bars (`chartBars` from `ADMIN.topCats`, 6): stack `gap:13px`
  - Label row: `display:flex; justify-content:space-between; font-size:13px; margin-bottom:5px` — `<span style="font-weight:600; color:#2C3A54">{{ b.label }}</span>` + `<span style="color:#93A1B8">{{ b.v }}</span>`
  - Track: `height:9px; background:#F0F3F8; border-radius:999px; overflow:hidden`; fill: `height:100%; width:{{ b.pct }}; background:{{ b.color }}; border-radius:999px`
  - Computation: `pct = Math.round((v / maxV) * 100) + '%'` where `maxV` = max of all values; colors cycle `['#14969E','#1B3568','#C6A15B','#14969E','#1B3568','#C6A15B']` by index.
  - Data: E-commerce 112 (→100%), Digital Marketing 93 (83%), Web Development 84 (75%), Mobile Apps 67 (60%), UI/UX 58 (52%), Branding 51 (46%).

**Right — pending providers** (same card style):
- Title `{{ t.aPendingTitle }}`: `15px/700; margin-bottom:16px`
- Items (`pendingCards` from `ADMIN.pendingProviders`, 4): stack `gap:12px`
  - Row: `border:1px solid #EEF1F6; border-radius:12px; padding:13px 16px; display:flex; align-items:center; gap:12px`
  - Info block (`flex:1; min-width:0`): name `{{ pd.name }}` `13.5px/600`; second line `{{ pd.city }} · {{ pd.d }}` `12px; #93A1B8`
  - `isPending` (`!pending[i]`): two pill buttons:
    - Approve `onClick={{ pd.approve }}`: `background:#E9F6EF; color:#1F7A4D; border:none; cursor:pointer; font-size:12px; font-weight:700; padding:6px 14px; border-radius:999px`; hover `background:#D7EEDF`. Label `{{ t.approve }}`.
    - Reject `onClick={{ pd.reject }}`: `background:#FBEDEB; color:#B0433A;` same metrics; hover `background:#F6DEDA`. Label `{{ t.reject }}`.
  - `isApproved` (`'a'`): `<span style="color:#1F7A4D; font-size:12.5px; font-weight:700">{{ t.approvedLbl }}</span>`
  - `isRejected` (`'r'`): `<span style="color:#B0433A; font-size:12.5px; font-weight:700">{{ t.rejectedLbl }}</span>`
  - Handlers set `pending[i]='a'|'r'` (no toast). Keyed by array index.
  - Data: Majed Al-Subaie — Frontend Dev (Riyadh, 2026/07/01), Dhaw Production Studio (Jeddah, 2026/06/30), Areej Al-Ghamdi — Graphic Designer (Abha, 2026/06/29), Numou Consulting (Riyadh, 2026/06/28).

i18n keys: `adminTitle, adminSub, aUsers, aClients, aProviders, aProjects, monthGrowth, aWeekly, aBriefs, aPending, aMatchRate, aTopCats, aPendingTitle, approve, reject, approvedLbl, rejectedLbl`.

---

## 5. Admin providers (`isAdminProviders`)

Wrapper: `<div data-screen-label="Admin providers" style="max-width: 1040px; margin: 0 auto;">`
- `<h1>` `{{ t.aProvidersTitle }}`: `24px/700; margin:0 0 20px`

Table container: `background:#fff; border:1px solid #E4E9F1; border-radius:18px; overflow:hidden`

**Header row**: `padding:13px 24px; display:grid; grid-template-columns: 2fr 1fr 1fr 1fr 1.2fr 1fr; gap:12px; background:#FAFBFD; border-bottom:1px solid #EEF1F6; font-size:12.5px; font-weight:700; color:#7684A0`
- Columns: `{{ t.thProvider }} | {{ t.thType }} | {{ t.thCity }} | {{ t.thRating }} | {{ t.thPrice }} | {{ t.thVerified }}`

**Rows** (`providerRows` = all 16 `PROVIDERS`): `padding:13px 24px;` same grid; `align-items:center; border-bottom:1px solid #F3F5F9`; hover: `background:#FAFBFD`
1. Provider cell: `display:flex; align-items:center; gap:11px; min-width:0`
   - Avatar: `width:34px; height:34px; border-radius:10px; background:{{ p.color }}; color:#fff; font-size:14px; font-weight:700; display:flex; align-items:center; justify-content:center; flex-shrink:0` — `{{ p.init }}` (Arabic initial from data, e.g. ع, ن, م…)
   - Name `{{ p.name }}`: `13.5px/600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis`
   - Role `{{ p.role }}`: `11.5px; #93A1B8;` same ellipsis
2. Type `{{ p.type }}`: `13px; #4A5A76`
3. City `{{ p.city }}`: same
4. Rating: `★ {{ p.rating }}`: same
5. Price `{{ p.price }}` (= `min.toLocaleString() + '–' + max.toLocaleString()`, e.g. `4,000–9,000`): same
6. Verified chip: `background:{{ p.vBg }}; color:{{ p.vFg }}; font-size:11.5px; font-weight:600; padding:3px 11px; border-radius:999px; justify-self:start`
   - verified → `t.verified`, bg `#E9F6EF`, fg `#1F7A4D`; not verified (providers 9, 14, 15) → `t.unverified`, bg `#F0F3F8`, fg `#93A1B8`

Avatar colors from data cycle `#1B3568 / #14969E / #C6A15B` per provider record. No row click handler.

i18n keys: `aProvidersTitle, thProvider, thType, thCity, thRating, thPrice, thVerified, verified, unverified`.

---

## 6. Admin projects (`isAdminProjects`)

Wrapper: `max-width:1040px; margin:0 auto` with `data-screen-label="Admin projects"`
- `<h1>` `{{ t.aProjectsTitle }}`: `24px/700; margin:0 0 20px`

Table container: same as providers (`#fff; 1px #E4E9F1; radius 18px; overflow hidden`).
**Header**: `padding:13px 24px; grid-template-columns: 2fr 1fr 1fr 1fr 1fr; gap:12px; background:#FAFBFD; border-bottom:1px solid #EEF1F6; 12.5px/700 #7684A0`
- Columns: `{{ t.thProject }} | {{ t.thClient }} | {{ t.thBudget }} | {{ t.thStatus }} | {{ t.thDate }}`

**Rows** (`projectRows` = 5 `PROJECTS`): `padding:15px 24px` (taller than providers), same grid, `align-items:center; border-bottom:1px solid #F3F5F9`; hover `background:#FAFBFD`
1. Project cell: title `{{ p.title }}` `14px/600`; category `{{ p.cat }}` `12px; #93A1B8`
2. Client: `{{ t.clientName }}` (same client name for all rows — i18n key) `13px; #4A5A76`
3. Budget `{{ p.budget }}`: `13px; #4A5A76`
4. Status chip: `background:{{ p.stBg }}; color:{{ p.stFg }}; font-size:12px; font-weight:600; padding:4px 12px; border-radius:999px; white-space:nowrap` — from `statusMap`:
   - `draft`: label `t.stDraft`, bg `#F0F3F8`, fg `#7684A0`
   - `brief`: `t.stBrief`, bg `#EEF3FB`, fg `#1B3568`
   - `matched`: `t.stMatched`, bg `#E8F5F6`, fg `#0E7A81`
   - `selected`: `t.stSelected`, bg `#F7F0E3`, fg `#8A6D33`
   - `inprogress`: `t.stInprogress`, bg `#FDF9F0`, fg `#8A6D33`
   - `completed`: `t.stCompleted`, bg `#E9F6EF`, fg `#1F7A4D`
5. Date `{{ p.date }}`: `13px; #93A1B8`

Data rows: Perfume e-commerce store (E-commerce, matched, 4,000–8,000, 2026/06/28); Specialty café brand identity (Branding, completed, 3,500–6,000, 2026/05/12); Riyadh Season campaign (Marketing, inprogress, 12,000–18,000, 2026/06/02); Salon booking app (Mobile Apps, draft, budget "—", 2026/07/01); Sales analytics dashboard (Data Analysis, brief, 6,000–10,000, 2026/06/20).

Note: `projectRows` also carries an `open` handler (`set({cPage:'detail'})`) used on the *client* projects screen — the admin table does not use it.

i18n keys: `aProjectsTitle, thProject, thClient, thBudget, thStatus, thDate, clientName, stDraft, stBrief, stMatched, stSelected, stInprogress, stCompleted`.

---

## 7. Admin users (`isAdminUsers`)

Wrapper: `max-width:1040px`, `data-screen-label="Admin users"`
- `<h1>` `{{ t.usersTitle }}`: `24px/700; margin:0 0 20px`

Table container: standard. **Header**: `padding:13px 24px; grid-template-columns: 2.2fr 1fr 1fr 1fr; gap:12px; background:#FAFBFD; border-bottom:1px solid #EEF1F6; 12.5px/700 #7684A0`
- Columns: `{{ t.thUser }} | {{ t.thRole }} | {{ t.thJoined }} | {{ t.thStatus }}`

**Rows** (`userRows` = 10 `USERS`): `padding:13px 24px;` same grid; `align-items:center; border-bottom:1px solid #F3F5F9`; hover `background:#FAFBFD`
1. User cell (`flex; gap:11px; min-width:0`):
   - Avatar **circle**: `width:34px; height:34px; border-radius:50%; background:{{ u.color }}; color:#fff; font-size:13px; font-weight:700; flex; centered; flex-shrink:0` — `{{ u.init }}` = first char of localized name
   - Name `{{ u.name }}`: `13.5px/600; nowrap ellipsis`
   - Email `{{ u.email }}` with **`dir="ltr"`** and `text-align:start`: `11.5px; #93A1B8; nowrap ellipsis` (LTR override inside RTL layout)
2. Role chip: `background:{{ u.roleBg }}; color:{{ u.roleFg }}; font-size:11.5px; font-weight:600; padding:3px 12px; border-radius:999px; justify-self:start` — from `roleChip` map (which also supplies avatar color `c`):
   - `client`: label `t.roleClient`, bg `#EEF3FB`, fg `#1B3568`, avatar `#1B3568`
   - `provider`: label `t.roleProvider`, bg `#E8F5F6`, fg `#0E7A81`, avatar `#14969E`
   - `admin`: label `t.roleAdminL`, bg `#F7F0E3`, fg `#8A6D33`, avatar `#14213A`
3. Joined `{{ u.joined }}`: `13px; #4A5A76`
4. Status chip (same metrics as role chip): active → `t.activeL`, bg `#E9F6EF`, fg `#1F7A4D`; suspended → `t.suspendedL`, bg `#FBEDEB`, fg `#B0433A`

Data: 10 users (5 clients incl. one suspended — Tariq Hassan `active:false`; 4 providers; 1 admin "Talaqi Team" ops@talaqi.sa). Emails and joined dates in `USERS`.

i18n keys: `usersTitle, thUser, thRole, thJoined, thStatus, roleClient, roleProvider, roleAdminL, activeL, suspendedL`.

---

## 8. Admin briefs review (`isAdminBriefs`)

Wrapper: `max-width:1040px`, `data-screen-label="Admin briefs review"`

### 8.1 Header (`margin-bottom:20px`)
- `<h1>` `{{ t.briefsTitle }}` (`24px/700; margin:0 0 4px`) + `<p>` `{{ t.briefsSub }}` (`#7684A0; 14.5px`)

### 8.2 Table
Container standard. **Header**: `padding:13px 24px; grid-template-columns: 2fr 1fr 1fr 1.2fr 1fr auto; gap:12px; bg #FAFBFD; border-bottom 1px #EEF1F6; 12.5px/700 #7684A0`
- Columns: `{{ t.thProject }} | {{ t.thCategory }} | {{ t.thDate }} | {{ t.thQuality }} | {{ t.thStatus }} |` empty `<span style="width:76px">` (button column spacer).

**Rows** (`briefRows` = 5 `BRIEFS_LIST`): each row is a wrapper `<div>` containing the row grid + optional expandable panel.

Row grid: `padding:14px 24px; grid-template-columns: 2fr 1fr 1fr 1.2fr 1fr auto; gap:12px; align-items:center; border-bottom:1px solid #F3F5F9`; hover `background:#FAFBFD`
1. Project: title `{{ b.title }}` `13.5px/600`; client `{{ b.client }}` `12px #93A1B8`
2. Category `{{ b.cat }}`: `13px #4A5A76`
3. Date `{{ b.date }}`: `13px #93A1B8`
4. Quality meter: `display:flex; align-items:center; gap:9px`
   - Track `flex:1; height:6px; background:#F0F3F8; border-radius:999px; overflow:hidden`; fill `height:100%; width:{{ b.qPct }}; background:{{ b.qColor }}`
   - Percent text `{{ b.q }}%`: `12.5px/700; color:{{ b.qColor }}`
   - `qPct = q + '%'`; `qColor = q >= 90 ? '#0E7A81' : '#8A6D33'`
5. Status chip: `background:{{ b.stBg }}; color:{{ b.stFg }}; 11.5px/600; padding:3px 12px; radius 999px; justify-self:start; white-space:nowrap` — approved → `t.approvedTag`, bg `#E9F6EF`, fg `#1F7A4D`; else → `t.pendingTag`, bg `#FDF9F0`, fg `#8A6D33`
6. Toggle button `onClick={{ b.toggle }}`: `background:#EEF3FB; color:#1B3568; border:none; cursor:pointer; font-size:12px; font-weight:700; padding:7px 16px; border-radius:999px; width:76px`; hover `background:#E1E9F6`. Label `{{ b.btnLabel }}` = `isOpen ? t.closeBtn : t.reviewBtn`.

**Toggle logic**: only row index 0 actually expands — `toggle` for row 0 sets `briefOpen = isOpen ? null : 0`; for all other rows `toggle = () => showToast(t.demoOnly)`. `isOpen = briefOpen === i`.

**Expandable panel** (`<sc-if value="{{ b.isOpen }}">`, rendered below the row inside the wrapper):
`background:#FAFBFD; border-bottom:1px solid #F3F5F9; padding:20px 24px`
- Eyebrow `{{ t.bSummary }}`: `font-size:12.5px; font-weight:700; color:#93A1B8; letter-spacing:.05em; margin-bottom:8px`
- Summary `{{ briefSummaryView }}`: `font-size:14px; color:#2C3A54; line-height:1.9; margin:0 0 14px; max-width:760px` — value = `edits.summary ?? BRIEF.summaryAr/En` (shares the client brief edit state)
- Chip row `display:flex; flex-wrap:wrap; gap:8px; margin-bottom:4px`:
  - Budget chip: `background:#EEF3FB; color:#1B3568; font-size:12px; font-weight:600; padding:5px 13px; border-radius:999px; white-space:nowrap` — `{{ t.bBudget }}: {{ briefBudgetView }} {{ briefBudgetUnit }}` (budget "4,000 – 8,000", unit "ريال سعودي"/"SAR")
  - Timeline chip: `background:#E8F5F6; color:#0E7A81;` same metrics — `{{ t.bTimeline }}: {{ briefTimeline }}` ("3 – 5 أسابيع"/"3–5 weeks")
  - Skill chips (`briefSkills` = `BRIEF.skills`, 5: E-commerce, UI/UX, Payment Integration, Shopify / WooCommerce, Shipping APIs): `background:#fff; border:1px solid #E4E9F1; color:#4A5A76; font-size:12px; font-weight:600; padding:5px 13px; border-radius:999px; white-space:nowrap`

Data (`BRIEFS_LIST`): Perfume store (E-commerce, 2026/06/28, q 96, approved), Coffee gear store (E-commerce, 2026/06/25, q 92, approved), Salon booking app (Mobile Apps, 2026/07/01, q 88, **pending**), Sales analytics dashboard (Data Analysis, 2026/06/20, q 91, approved), Café brand identity (Branding, 2026/05/12, q 85, approved). qColor: 96→teal, 92→teal, 88→gold, 91→teal, 85→gold.

i18n keys: `briefsTitle, briefsSub, thProject, thCategory, thDate, thQuality, thStatus, approvedTag, pendingTag, closeBtn, reviewBtn, bSummary, bBudget, bTimeline, demoOnly`.

---

## 9. Admin matching analytics (`isAdminAnalytics`)

Wrapper: `max-width:1040px`, `data-screen-label="Admin matching analytics"`

### 9.1 Header (`margin-bottom:22px`)
- `<h1>` `{{ t.anTitle }}` (`24px/700; margin:0 0 4px`) + `<p>` `{{ t.anSub }}` (`#7684A0; 14.5px`)

### 9.2 KPI row (3 cards, `grid repeat(3,1fr); gap:16px; margin-bottom:18px`)
1. **Avg score (gradient hero card)**: `background:linear-gradient(150deg, #1B3568, #0F5E64); border-radius:16px; padding:22px; color:#fff` — label `{{ t.anAvgScore }}` `13px; opacity:.75; margin-bottom:6px`; value `{{ anAvg }}%` (=86) `font-size:30px; font-weight:700`
2. **Acceptance rate**: white card (`#fff; 1px #E4E9F1; radius 16; padding 22`) — label `{{ t.anAccept }}` `13px #7684A0`; value `{{ anAccept }}%` (=74) `30px/700; color:#0E7A81`
3. **Match time**: white card — label `{{ t.anTime }}`; value `{{ anTime }}` (="3.2 دقيقة"/"3.2 min") `30px/700; color:#1B3568`

### 9.3 Charts row (`grid 1fr 1fr; gap:18px; margin-bottom:18px`)

**Left — score distribution bars** (card `#fff; 1px #E4E9F1; radius 18; padding 24`):
- Title `{{ t.anDistT }}`: `15px/700; margin-bottom:18px`
- Rows (`anDist` from `ANALYTICS.dist`, 4): stack `gap:13px`; identical structure to overview chart bars:
  - Label row `flex; space-between; 13px; margin-bottom:5px`: range `{{ d.r }}` `600 #2C3A54`, value `{{ d.v }}%` `#93A1B8`
  - Track `height:9px; background:#F0F3F8; radius 999; overflow hidden`; fill `width:{{ d.pct }}; background:{{ d.color }}`
  - `pct = Math.round((v / distMax) * 100) + '%'` (distMax = 38); colors by index: `['#14969E','#1B3568','#C6A15B','#93A1B8']`
  - Data: "90 – 100" 38 (100%), "80 – 89" 31 (82%), "70 – 79" 19 (50%), "Below 70"/"أقل من 70" 12 (32%).

**Right — weekly matches column chart** (card, `display:flex; flex-direction:column`):
- Title `{{ t.anWeeklyT }}`: `15px/700; margin-bottom:18px`
- Chart area: `flex:1; display:flex; align-items:flex-end; gap:12px; min-height:150px`
- Each column (`anWeekly`, 7): `flex:1; display:flex; flex-direction:column; align-items:center; gap:7px`
  - Value label `{{ w.v }}`: `font-size:11.5px; font-weight:700; color:#1B3568`
  - Bar: `width:100%; max-width:34px; height:{{ w.h }}; background:{{ w.color }}; border-radius:8px 8px 3px 3px`
  - Day label `{{ w.day }}`: `11px; #93A1B8`
  - Computation: `h = Math.max(12, Math.round((v / wMax) * 120)) + 'px'`; `color = v === wMax ? '#1B3568' : '#8ED4D9'` (max bar is navy, others light teal)
  - Data `[6,9,5,11,8,3,4]`, wMax=11 → heights `[65,98,55,120,87,33,44]px`; Wednesday (11) is navy. Days: أحد اثنين ثلاثاء أربعاء خميس جمعة سبت / Sun..Sat.

### 9.4 Revenue section
- Section title `{{ t.anRevT }}`: `15px/700; margin-bottom:14px`
- Cards (`grid repeat(3,1fr); gap:16px`):
  1. MRR: white card (radius 16, padding 22) — label `{{ t.revMrr }}` `13px #7684A0`; value `{{ revMrr }}` (= "48,500") `font-size:26px; font-weight:700; color:#1B3568` followed by inline `<span style="font-size:13px; font-weight:500; color:#93A1B8">{{ t.perProject }}</span>` (currency/unit suffix)
  2. Subscriptions: white card — label `{{ t.revSubs }}`; value `{{ revSubs }}` (= "214") `26px/700 #1B3568`
  3. Growth (gold card): `background:#F7F0E3; border:1px solid #EFE2C6; border-radius:16px; padding:22px` — label `{{ t.revGrowth }}` `13px; color:#8A6D33`; value `{{ revGrowth }}` (= "+18%") `26px/700; color:#8A6D33`

i18n keys: `anTitle, anSub, anAvgScore, anAccept, anTime, anDistT, anWeeklyT, anRevT, revMrr, revSubs, revGrowth, perProject`.

---

## 10. Admin categories (`isAdminCats`)

Wrapper: `max-width:1040px`, `data-screen-label="Admin categories"`
- `<h1>` `{{ t.aNavCats }}` (reuses the nav label): `24px/700; margin:0 0 20px`

### 10.1 Categories grid (`cats` from `CATEGORIES`, 16 items)
`display:grid; grid-template-columns: repeat(4,1fr); gap:14px`
Card: `background:#fff; border:1px solid #E4E9F1; border-radius:14px; padding:18px 20px`
- Name `{{ c.name }}` (ar/en): `font-size:14.5px; font-weight:700; color:#2C3A54; margin-bottom:3px`
- Count line: `font-size:12.5px; color:#93A1B8` — `{{ c.count }} {{ t.catProject }}` (e.g. "84 مشروع")
- Data: 16 categories with counts 84, 112, 67, 58, 45, 51, 93, 40, 33, 29, 24, 18, 14, 16, 21, 38 (Web Dev, E-commerce, Mobile, UI/UX, Graphic Design, Branding, Digital Marketing, Social Media, Content Writing, Photography, Business Consulting, Accounting, Legal, Cybersecurity, Data Analysis, AI Solutions).

### 10.2 Skills section header
`display:flex; justify-content:space-between; align-items:center; margin:34px 0 16px`
- `<h2>` `{{ t.skillsT }}`: `18px/700; margin:0`
- Button group `display:flex; gap:8px`:
  - Add category `onClick={{ demoToast }}`: `background:#EEF3FB; color:#1B3568; border:none; cursor:pointer; font-size:12.5px; font-weight:700; padding:7px 16px; border-radius:999px` — `{{ t.addCatBtn }}`
  - Add skill `onClick={{ demoToast }}`: `background:#E8F5F6; color:#0E7A81;` same metrics — `{{ t.addSkillBtn2 }}`
  - `demoToast = () => showToast(t.demoOnly)`

### 10.3 Skills chip cloud (`skillChips` from `SKILLS`, 20 items)
Container: `background:#fff; border:1px solid #E4E9F1; border-radius:18px; padding:22px; display:flex; flex-wrap:wrap; gap:9px`
Each chip: `display:inline-flex; align-items:center; gap:8px; background:#FBFCFE; border:1px solid #E4E9F1; border-radius:999px; padding:6px 7px 6px 14px; white-space:nowrap`
- Skill name `{{ sk.n }}` with **`dir="ltr"`** (skill names are Latin): `font-size:13px; font-weight:600; color:#2C3A54; white-space:nowrap`
- Category tag `{{ sk.c }}` (localized `cAr/cEn`): `font-size:11px; font-weight:600; color:#7684A0; background:#F0F3F8; border-radius:999px; padding:2px 10px; white-space:nowrap`

Note on the `6px 7px 6px 14px` padding: this is *physical* TRBL in source; in RTL it visually puts 14px on the name side and 7px on the tag side — in a logical-property rebuild use `padding-block:6px; padding-inline-start:14px; padding-inline-end:7px` **only if** the visual result matches; verify against prototype in both directions (the source is physical, so LTR mode flips which side gets 14px — safest is to replicate physical values).

Data: 20 skills — Shopify, WooCommerce, Payment Integration, Shipping APIs (E-commerce); React (Web Dev); Flutter (Mobile); Figma, UI/UX, Motion Design (Design); Logo Design, Brand Guidelines (Branding); SEO, Media Buying (Marketing); Copywriting (Content); Product Photography, Video Editing (Photography); Power BI, Python (Data); Pentesting (Security); Zakat & Tax (Accounting).

i18n keys: `aNavCats, catProject, skillsT, addCatBtn, addSkillBtn2, demoOnly`.

---

## 11. Settings — shared by all roles (`isSettings`)

Wrapper: `<div data-screen-label="Settings" style="max-width: 720px; margin: 0 auto;">`
- `<h1>` `{{ settingsLabel }}` (= `t.cNavSettings` regardless of role): `24px/700; margin:0 0 20px`

### 11.1 Language card
Card: `background:#fff; border:1px solid #E4E9F1; border-radius:18px; padding:24px; margin-bottom:16px`
- Title `{{ t.setLangT }}`: `15px/700; margin-bottom:3px`
- Description `{{ t.setLangD }}`: `13px; #93A1B8; margin-bottom:16px`
- Segmented toggle: `display:inline-flex; background:#F0F3F8; border-radius:999px; padding:4px; gap:2px`
  - Arabic button `onClick={{ setAr }}` (sets `lang='ar'`), literal label `العربية`: `background:{{ arBg }}; color:{{ arFg }}; border:none; cursor:pointer; font-size:13.5px; font-weight:700; padding:8px 26px; border-radius:999px; box-shadow:{{ arShadow }}`
  - English button `onClick={{ setEn }}` (sets `lang='en'`), literal label `English`: same with `enBg/enFg/enShadow`
  - Active-state values: active → `bg:#fff; fg:#1B3568; box-shadow:0 2px 6px rgba(20,40,80,.12)`; inactive → `bg:transparent; fg:#7684A0; shadow:none`. (`ar` active when `lang==='ar'`.)
  - Switching language flips the whole app `dir` (rtl↔ltr) and all i18n strings.

### 11.2 Notifications card
Same card style (`padding:24px; margin-bottom:16px`)
- Title `{{ t.setNotifT }}`: `15px/700; margin-bottom:16px`
- Items (`notifItems`, 3 — labels from `t.notifs[0..2]` array): stack `display:flex; flex-direction:column; gap:14px`
- Row: `display:flex; align-items:center; justify-content:space-between; gap:14px`
  - Label `{{ n.label }}`: `font-size:14px; color:#2C3A54`
  - Toggle switch button `onClick={{ n.toggle }}`: `width:44px; height:25px; border-radius:999px; border:none; cursor:pointer; background:{{ n.bg }}; position:relative; flex-shrink:0; transition: background .2s`
    - Knob: `<span style="position:absolute; top:3px; inset-inline-start:{{ n.knob }}; width:19px; height:19px; border-radius:50%; background:#fff; box-shadow:0 1px 4px rgba(0,0,0,.25); transition: inset-inline-start .2s;">`
    - On: `bg:#14969E; knob inset-inline-start:22px`; Off: `bg:#D5DDE9; knob inset-inline-start:3px`. Note **logical** `inset-inline-start` — knob animates from the start side in both RTL and LTR.
  - Initial state: `{0:true, 1:true, 2:false}`. `toggle` flips `notif[i]`.

### 11.3 Account card
Same card style (`padding:24px`, no bottom margin)
- Title `{{ t.setAccountT }}`: `15px/700; margin-bottom:16px`
- Button row: `display:flex; gap:10px; flex-wrap:wrap` — all three `onClick={{ demoToast }}` (shows `t.demoOnly` toast):
  1. Change password `{{ t.changePass }}`: `background:#F0F3F8; color:#1B3568; border:none; cursor:pointer; font-size:13.5px; font-weight:600; padding:11px 20px; border-radius:10px`; hover `background:#E4E9F1`
  2. Export data `{{ t.exportData }}`: identical styles/hover
  3. Delete account `{{ t.deleteAcc }}`: `background:#FBEDEB; color:#B0433A;` same metrics; hover `background:#F6DEDA`

i18n keys: `cNavSettings, setLangT, setLangD, setNotifT, notifs (array of 3), setAccountT, changePass, exportData, deleteAcc, demoOnly`.

---

## 12. After the shell: overlays & toast (global)

The app-shell `<sc-if value="{{ isApp }}">` closes after Settings (`</div></div></div></sc-if>`). Two global fixed layers follow, rendered outside the shell (visible on any view):

### 12.1 Generating overlay (`<sc-if value="{{ generating }}">`)
Belongs to the client brief-generation flow but is global-positioned:
- Backdrop: `position:fixed; inset:0; z-index:100; background:rgba(15,25,45,.55); backdrop-filter:blur(6px); display:flex; align-items:center; justify-content:center`
- Modal: `background:#fff; border-radius:22px; padding:40px 48px; width:440px; max-width:90vw; box-shadow:0 30px 80px rgba(0,0,0,.3)` with `dir="{{ dir }}"` (must re-declare dir since it portals outside the dir'd shell)
- Header row: `display:flex; align-items:center; gap:14px; margin-bottom:26px`
  - Spinner: `width:40px; height:40px; border:3px solid #E4E9F1; border-top-color:#14969E; border-radius:50%; animation: tq-spin 1s linear infinite; flex-shrink:0` (define `@keyframes tq-spin { to { transform: rotate(360deg) } }`)
  - Title `{{ t.generating }}`: `font-size:17px; font-weight:700; color:#14213A`
- Steps list (`genSteps`, 4 — labels `t.genStep1..genStep4`): stack `gap:14px`; each row `display:flex; gap:12px; align-items:center; opacity:{{ g.opacity }}`
  - Badge: `width:22px; height:22px; border-radius:50%; background:{{ g.bg }}; color:{{ g.fg }}; font-size:12px; font-weight:700; flex; centered; flex-shrink:0` — `{{ g.mark }}`
  - Label: `font-size:14px; color:#2C3A54; font-weight:500`
  - Per-step state (from `genStep` counter, ticks every **850ms**, 5 ticks then navigates to brief):
    - done (`genStep > i`): mark `✓`, bg `#E9F6EF`, fg `#1F7A4D`, opacity 1
    - active (`genStep === i`): mark `i+1`, bg `#E8F5F6`, fg `#0E7A81`, opacity 1
    - upcoming: mark `i+1`, bg `#F0F3F8`, fg `#93A1B8`, opacity **0.45**

### 12.2 Toast (`<sc-if value="{{ toast }}">`)
`position:fixed; bottom:28px; inset-inline-start:50%; transform: translateX({{ toastShift }}); z-index:120; background:#14213A; color:#fff; font-size:14px; font-weight:600; padding:13px 26px; border-radius:12px; box-shadow:0 14px 40px rgba(0,0,0,.3); animation: tq-rise .3s ease both`
- Content: `{{ toast }}` (the state string)
- `toastShift = ar ? '50%' : '-50%'` — because `inset-inline-start:50%` resolves to `right:50%` in RTL, the translate flips sign to keep it horizontally centered. In a rebuild you can simply use `left:50%; transform:translateX(-50%)` (physical) or keep the logical+shift pair.
- Define `@keyframes tq-rise { from { opacity:0; transform: translateX(var(--shift)) translateY(10px) } to { opacity:1; transform: translateX(var(--shift)) } }` (source animation name `tq-rise`; exact keyframes are defined in the page's global CSS — rise-in ~10px + fade over .3s ease).
- Auto-dismiss after 2600ms (see `showToast`).
- Toast triggers on these screens: opportunity accept (`t.accepted`), request send (`t.reqSentLbl`), brief review button on non-first rows (`t.demoOnly`), category/skill add buttons (`t.demoOnly`), account buttons (`t.demoOnly`).

---

## 13. Full i18n key inventory for these screens

`providerWelcome, providerWelcomeSub, pStatOps, pStatActive, pStatRating, pStatResponse, opsTitle, opsSub, matchScore, clientLabel, budgetLabel, perProject, timelineLabel, accept, decline, accepted, declined, profileTitle, profileSub, profileCompletion, verifiedBadge, pfType, pfCity, pfYears, pfLangs, pfPrice, pfAvail, pfSkills, addSkill, pfServices, servicesItems[], pfPortfolio, portfolioItems[], requestsTitle, requestsSub, reqReceived, reqSend, reqSentLbl, adminTitle, adminSub, aUsers, aClients, aProviders, aProjects, monthGrowth, aWeekly, aBriefs, aPending, aMatchRate, aTopCats, aPendingTitle, approve, reject, approvedLbl, rejectedLbl, aProvidersTitle, thProvider, thType, thCity, thRating, thPrice, thVerified, verified, unverified, aProjectsTitle, thProject, thClient, thBudget, thStatus, thDate, clientName, stDraft, stBrief, stMatched, stSelected, stInprogress, stCompleted, usersTitle, thUser, thRole, thJoined, roleClient, roleProvider, roleAdminL, activeL, suspendedL, briefsTitle, briefsSub, thCategory, thQuality, approvedTag, pendingTag, closeBtn, reviewBtn, bSummary, bBudget, bTimeline, anTitle, anSub, anAvgScore, anAccept, anTime, anDistT, anWeeklyT, anRevT, revMrr, revSubs, revGrowth, aNavCats, catProject, skillsT, addCatBtn, addSkillBtn2, cNavSettings, setLangT, setLangD, setNotifT, notifs[3], setAccountT, changePass, exportData, deleteAcc, demoOnly, generating, genStep1..genStep4` — plus nav keys `pNavHome, pNavRequests, pNavProfile, pNavSettings, aNavOverview, aNavUsers, aNavProviders, aNavProjects, aNavBriefs, aNavAnalytics, aNavSettings`.

## 14. Data model dependencies

From `talaqi-data.js`: `PROVIDERS` (16 — used by admin providers table + provider profile [index 0]), `OPPORTUNITIES` (3), `REQUESTS` (3), `ADMIN` (stats, topCats[6], pendingProviders[4]), `USERS` (10), `BRIEFS_LIST` (5), `ANALYTICS` (avg/accept/time, dist[4], weekly {daysAr, daysEn, v[7]}, rev {mrr, subs, growth}), `SKILLS` (20), `CATEGORIES` (16), `PROJECTS` (5 — admin projects table), `BRIEF` (summary/budget/timeline/skills — reused in briefs review expanded panel), `I18N.ar / I18N.en`.
