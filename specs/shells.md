# Talaqi — App Shells, Chrome & Shared UI Patterns Spec

Source of truth: `Talaqi Platform.dc.html` (design handoff prototype). Target: Next.js 15 + TypeScript + Tailwind.
Template syntax reminder: `{{ t.key }}` = i18n lookup, `{{ handler }}` = event handler, `<sc-if value="{{ cond }}">` = conditional render, `<sc-for list="{{ x }}" as="y">` = list render, `style-hover="..."` = hover styles, `style-focus="..."` = focus styles.

**Direction:** Arabic (`ar`) is the default language, `dir="rtl"` on the root wrapper (`dir = ar ? 'rtl' : 'ltr'`). ALL spacing uses CSS logical properties in the prototype (`margin-inline-start`, `border-inline-end`, `inset-inline-start`, `padding-inline`, `border-inline-start`). Preserve this — use Tailwind logical utilities (`ms-*`, `me-*`, `border-e`, `start-*`) so RTL/LTR both work.

---

## 0. Global CSS / Design Tokens

### 0.1 Base styles (from `<helmet><style>`)

```css
html, body { margin: 0; padding: 0; background: #F6F8FB; }
* { box-sizing: border-box; }
input, textarea, button { font-family: inherit; }
::placeholder { color: #93A1B8; }
```

### 0.2 Keyframes (exact)

```css
@keyframes tq-blink { 0%, 100% { opacity: .2; } 50% { opacity: 1; } }
@keyframes tq-pulse { 0%, 100% { transform: scale(1); opacity: .5; } 50% { transform: scale(1.5); opacity: 1; } }
@keyframes tq-rise  { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
@keyframes tq-spin  { to { transform: rotate(360deg); } }
```

Usage map:
- `tq-blink 1.2s infinite` (staggered `.2s` / `.4s` delays) — chat "typing" dots.
- `tq-rise .3s ease both` — chat message entrance AND toast entrance.
- `tq-spin 1s linear infinite` — brief-generation modal spinner.
- `tq-pulse` — landing-page decorative pulse dots (reserved; used on landing hero).

### 0.3 Font

Google Fonts: **IBM Plex Sans Arabic**, weights `300;400;500;600;700` (`display=swap`), with `preconnect` to `fonts.googleapis.com` and `fonts.gstatic.com` (crossorigin).

Root wrapper div:

```
font-family: 'IBM Plex Sans Arabic', system-ui, sans-serif;
color: #1A2438; background: #F6F8FB; min-height: 100vh;
font-size: 15px; line-height: 1.7;
```

### 0.4 Color palette (constants used in logic: `NAVY = '#1B3568'`, `TEAL = '#14969E'`)

| Token | Hex | Usage |
|---|---|---|
| Navy (primary) | `#1B3568` | brand, primary buttons, active nav, headings accents |
| Navy hover | `#24437F` | primary button hover |
| Dark navy | `#14213A` | footer bg, toast bg, admin avatar, heading text |
| Teal (accent) | `#14969E` | accents, badges, focus borders, progress |
| Teal dark | `#0E7A81` | teal text-on-light, provider accept button |
| Teal deep gradient stop | `#0F5E64` | dark gradient cards |
| Teal light bar | `#8ED4D9` | analytics weekly bars (non-max) |
| Teal pale check | `#7FE3E9` | checkmarks on dark pricing card |
| Gold | `#C6A15B` | complexity bar, chart accents, dots |
| Gold text | `#8A6D33` | gold-tinted chip text |
| Gold text dark | `#6E5A31` | note text on `#FDF9F0` |
| Green | `#1F7A4D` | success text |
| Green dot | `#2FA36B` | online dot, growth text |
| Red | `#B0433A` | danger text |
| Page bg | `#F6F8FB` | body |
| Card bg | `#fff` | cards, topbar, sidebar |
| Soft bg | `#F0F3F8` | pills, segmented controls, ghost buttons |
| Row hover bg | `#FAFBFD` | table header bg + row hover |
| Input bg | `#FBFCFE` | inputs, chat canvas |
| Border | `#E4E9F1` | primary border |
| Border light | `#EEF1F6` | inner dividers |
| Border lighter | `#F3F5F9` | table row dividers |
| Border mid | `#D5DDE9` | secondary button border, toggles off |
| Text primary | `#1A2438` | body |
| Text dark | `#14213A` / `#2C3A54` | headings / strong body |
| Text mid | `#4A5A76` / `#3D4C68` | secondary body / nav links |
| Text muted | `#7684A0` | subtitles |
| Text faint | `#93A1B8` | placeholders, meta, inactive |
| Nav dot inactive | `#C9D3E2` | sidebar dots |
| Footer muted | `#8A9AB8` / `#C4CFE2` / `#6B7C9E` | footer heading / links / legal |

Tinted chip backgrounds (see §5.4 status chips):
`#EEF3FB` (navy tint), `#E8F5F6` (teal tint), `#F7F0E3` (gold tint), `#FDF9F0` (pale gold), `#E9F6EF` (green tint), `#FBEDEB` (red tint), `#F2F7F9` + border `#DCEBEE` (teal-gray info), border tints `#C6E7E9` (teal), `#EFE2C6` (gold), `#D5DDE9` (navy).

---

## 1. Dashboard App Shell (`isApp` ⇔ `view === 'app'`)

Outer wrapper: `min-height: 100vh; display: flex; flex-direction: column;`

### 1.1 Top bar

Container: `background: #fff; border-bottom: 1px solid #E4E9F1; position: sticky; top: 0; z-index: 40;`
Inner row: `padding: 10px 20px; display: flex; align-items: center; gap: 18px;` (full width — no max-width).

Left→right (start→end) contents:

1. **Logo block** (onClick `{{ goLanding }}`, `cursor: pointer`, `display: flex; align-items: center; gap: 9px;`):
   - `<img src="assets/logo-mark.png">` — `width: 30px; height: 29px; object-fit: contain;`
   - Brand text `{{ t.brand }}` — `font-weight: 700; font-size: 17px; color: #1B3568;`
2. **Demo-mode badge** `{{ t.demoMode }}`: `background: #F7F0E3; color: #8A6D33; font-size: 11.5px; font-weight: 600; padding: 3px 10px; border-radius: 999px;`
3. **Role switcher** (pushed to end via `margin-inline-start: auto`): segmented pill container `display: flex; background: #F0F3F8; border-radius: 999px; padding: 4px; gap: 2px;`. Iterates `{{ roles }}` (3 items: client / provider / admin, labels `t.roleClient`, `t.roleProvider`, `t.roleAdmin`). Each button:
   - `font-size: 13px; font-weight: 600; padding: 7px 18px; border-radius: 999px; border: none;`
   - Active role: `bg: #fff; fg: #1B3568; box-shadow: 0 2px 6px rgba(20,40,80,.12)`
   - Inactive: `bg: transparent; fg: #7684A0; shadow: none`
   - Click: `setState({ role: r.key })` (does NOT reset the sub-page).
4. **Language toggle** (onClick `{{ toggleLang }}`, label `{{ t.langBtn }}`): `background: #F0F3F8; border: 1px solid #E4E9F1; font-size: 12.5px; font-weight: 600; color: #1B3568; padding: 6px 13px; border-radius: 999px;`. `toggleLang` flips `lang` between `ar`/`en`.
5. **Back-to-site link** (onClick `{{ goLanding }}`): text `{{ t.backToSite }} ↗`, ghost button `background: none; border: none; font-size: 13px; font-weight: 600; color: #7684A0;` hover → `color: #1B3568`. Navigates to `{ view: 'landing', pubPage: 'home' }` + scroll top.
6. **Avatar tile**: `width: 34px; height: 34px; border-radius: 50%; color: #fff; font-size: 14px; font-weight: 700; display: flex; align-items: center; justify-content: center;`
   - `avatarBg`: admin → `#14213A`, provider → `#14969E`, client → `#1B3568`.
   - `avatarInit`: admin → `م`, provider → `ع`, client → `أ`.

### 1.2 Body row

`display: flex; flex: 1; min-height: 0;` containing sidebar + main.

### 1.3 Sidebar (shared frame, role-specific nav)

Container: `width: 232px; flex-shrink: 0; background: #fff; border-inline-end: 1px solid #E4E9F1; padding: 18px 12px; display: flex; flex-direction: column; gap: 3px;`

**Sidebar title** `{{ sidebarTitle }}`: `font-size: 11.5px; font-weight: 700; color: #93A1B8; letter-spacing: .06em; padding: 0 12px 10px;`
- client → `t.clientName`; provider → provider #0 name (`PROVIDERS[0].ar|en`); admin → literal `'إدارة المنصة'` / `'Platform admin'`.

**Nav item** (button, iterated from `{{ sideNav }}`):

```
display: flex; align-items: center; gap: 11px;
font-size: 14px; padding: 10px 12px; border-radius: 10px;
text-align: start; width: 100%; border: none;
hover: background #F0F3F8
```

Computed per item (`navItem(label, active, go, badge)`):
- Active: `bg: #EEF3FB; fg: #1B3568; font-weight: 700; dot color: #14969E; dot border-radius: 2px` (square-ish dot)
- Inactive: `bg: transparent; fg: #4A5A76; font-weight: 500; dot color: #C9D3E2; dot border-radius: 50%` (round dot)
- Dot element: `width: 8px; height: 8px; flex-shrink: 0;` (the "icon" — there are no other icons)
- Label span: `flex: 1`
- Optional badge (rendered only if truthy): `background: #14969E; color: #fff; font-size: 11px; font-weight: 700; padding: 1px 8px; border-radius: 999px;`
- Click handler sets the page and scrolls to top.

**Nav lists per role** (label i18n key, active-state page, badge logic):

Client (`cPage`):
1. `t.cNavHome` → `home`
2. `t.cNavNew` → `chat`
3. `t.cNavBrief` → `brief` — badge `'1'` when `briefReady`
4. `t.cNavMatches` → `matches` — badge `'6'` when `briefReady`
5. `t.cNavProjects` → `projects`
6. `t.cpTitle` → `profile`
7. `t.cNavSettings` → `settings`

Provider (`pPage`):
1. `t.pNavHome` → `home` — badge `'3'` (always)
2. `t.pNavRequests` → `requests` — badge `'2'` (always)
3. `t.pNavProfile` → `profile`
4. `t.pNavSettings` → `settings`

Admin (`aPage`):
1. `t.aNavOverview` → `overview`
2. `t.aNavUsers` → `users`
3. `t.aNavProviders` → `providers` — badge `'12'` (always)
4. `t.aNavProjects` → `projects`
5. `t.aNavBriefs` → `briefs`
6. `t.aNavAnalytics` → `analytics`
7. `t.aNavCats` → `cats`
8. `t.aNavSettings` → `settings`

**Sidebar footer card** (pinned bottom with `margin-top: auto`):
`background: #F2F7F9; border: 1px solid #DCEBEE; border-radius: 14px; padding: 14px;`
- Line 1 `{{ t.tagline }}`: `font-size: 13px; font-weight: 700; color: #0E7A81; margin-bottom: 4px;`
- Line 2 literal `Talaqi AI v0.9`: `font-size: 12px; color: #7684A0;`

### 1.4 Main content area

`flex: 1; min-width: 0; padding: 28px 30px; overflow-x: hidden;`

Per-screen inner containers are centered with `margin: 0 auto` and these **max-widths**:

| Screen | max-width |
|---|---|
| Client home / matches / projects / project detail / provider home / provider requests | `1000px` |
| Client chat | `780px` (plus `height: calc(100vh - 130px); display:flex; flex-direction:column`) |
| Client brief / provider profile | `900px` |
| Client profile | `860px` |
| Admin (all screens) | `1040px` |
| Settings (all roles) | `720px` |

Screen-visibility conditionals (exhaustive):
`isClientHome|Chat|Brief|Matches|Projects|Detail|Profile` = `view==='app' && role==='client' && cPage===...`;
`isProviderHome|Requests|Profile` = provider + `pPage`; `isAdminOverview|Users|Providers|Projects|Briefs|Analytics|Cats` = admin + `aPage`;
`isSettings` = any role with its `*Page === 'settings'` (single shared Settings screen, title `{{ settingsLabel }}` = `t.cNavSettings`).

---

## 2. Public Site Nav & Footer (`isLanding` ⇔ `view === 'landing'`)

### 2.1 Sticky blurred nav

Outer: `position: sticky; top: 0; z-index: 50; background: rgba(255,255,255,.92); backdrop-filter: blur(12px); border-bottom: 1px solid #E4E9F1;`
Inner: `max-width: 1180px; margin: 0 auto; padding: 14px 24px; display: flex; align-items: center; gap: 24px;`

1. **Logo block** (onClick `{{ goTop }}` = smooth scroll to top): img `assets/logo-mark.png` `36px × 35px, object-fit: contain`, gap 10px; brand `{{ t.brand }}` `font-weight: 700; font-size: 19px; color: #1B3568; line-height: 1.2;`
2. **Center links** (`display: flex; gap: 4px; margin-inline-start: auto; align-items: center;`) — all ghost buttons `background: none; border: none; font-size: 14px; padding: 8px 10px; border-radius: 8px;` hover `background: #F0F3F8`:
   - `t.navHow` → `scrollHow` (anchor `#tq-how`) — static `font-weight: 500; color: #3D4C68`
   - `t.navClients` → `goPubClients` — active when `pubPage==='clients'`: weight `700` + color `#1B3568`, else `500` / `#3D4C68` (same pattern for the next two)
   - `t.navProviders` → `goPubProviders`
   - `t.navAbout` → `goPubAbout`
   - `t.navPricing` → `scrollPricing` (anchor `#tq-pricing`) — static 500/`#3D4C68`
   - `t.navContact` → `goPubContact` — active-aware
   - Anchor scrolls use `anchorScroll(id)`: if not on landing home, first navigate there and scroll after 200ms; scroll offset is `top − 70px`, `behavior: 'smooth'`.
3. **Right cluster** (`display: flex; gap: 10px; align-items: center;`):
   - Language toggle `{{ t.langBtn }}`: `background: #F0F3F8; border: 1px solid #E4E9F1; font-size: 13px; font-weight: 600; color: #1B3568; padding: 7px 14px; border-radius: 999px;` hover `background: #E4E9F1`
   - Login link `{{ t.login }}` → `goLogin` (pubPage `login`): ghost `font-size: 14px; font-weight: 600; color: #1B3568; padding: 8px 12px;`
   - CTA `{{ t.startCta }}` → `goSignupC` (sets `signupRole: 'client'`, pubPage `signup`): `background: #1B3568; color: #fff; font-size: 14px; font-weight: 600; padding: 10px 20px; border-radius: 10px; box-shadow: 0 4px 14px rgba(27,53,104,.25);` hover `background: #24437F`

Public sub-pages: `isPubHome|About|Clients|Providers|Contact|Login|Signup` = `view==='landing' && pubPage===...`.

### 2.2 Footer (navy)

Outer: `background: #14213A; color: #fff;`

**Columns row**: `max-width: 1180px; margin: 0 auto; padding: 52px 24px 36px; display: grid; grid-template-columns: 2fr 1fr 1fr; gap: 40px;`

- Col 1 (brand): logo row `display:flex; align-items:center; gap:10px; margin-bottom:12px` — logo sits in white plate `background:#fff; border-radius:10px; padding:5px` containing img `28px × 27px; object-fit:contain; display:block`; brand `{{ t.brand }}` `font-weight:700; font-size:18px`. Below: `{{ t.positioning }}` paragraph `font-size: 13.5px; color: #8A9AB8; max-width: 340px; margin: 0;`
- Col 2 (`display:flex; flex-direction:column; gap:10px`): heading `{{ t.footerLinks1 }}` `font-size:13px; font-weight:700; color:#8A9AB8; margin-bottom:4px`; links (spans, `font-size:13.5px; color:#C4CFE2; cursor:pointer`): `t.navHow`→`scrollHow`, `t.navCats`→`scrollCats` (anchor `#tq-cats`), `t.navPricing`→`scrollPricing`, `t.navClients`→`goPubClients`.
- Col 3: heading `{{ t.footerLinks2 }}` same style; links: `t.footerAbout`→`goPubAbout`, `t.navProviders`→`goPubProviders`, `t.footerContact`→`goPubContact`, `t.footerTerms` (no handler).

**Legal bar**: wrapper `border-top: 1px solid rgba(255,255,255,.08);` inner `max-width: 1180px; margin: 0 auto; padding: 18px 24px; display: flex; justify-content: space-between; flex-wrap: wrap; gap: 10px; font-size: 12.5px; color: #6B7C9E;` with `{{ t.footerRights }}` and `{{ t.footerMade }}`.

---

## 3. Toast Component

Rendered when `{{ toast }}` (state string) is truthy:

```
position: fixed; bottom: 28px; inset-inline-start: 50%;
transform: translateX({{ toastShift }});  /* '50%' when RTL, '-50%' when LTR */
z-index: 120;
background: #14213A; color: #fff;
font-size: 14px; font-weight: 600;
padding: 13px 26px; border-radius: 12px;
box-shadow: 0 14px 40px rgba(0,0,0,.3);
animation: tq-rise .3s ease both;
```

Behavior (`showToast(msg)`): sets `toast: msg`, clears any prior timer, auto-clears after **2600ms**. No exit animation (unmounts). Content is the raw message string.

Known toast messages (i18n keys): `t.briefApprovedToast`, `t.proposalSent`, `t.accepted`, `t.reqSentLbl`, `t.contactSentToast`, `t.signupToast`, `t.demoOnly` (used for stubbed actions).

Note on the centering trick: `inset-inline-start: 50%` + `translateX(±50%)` keeps the pill horizontally centered in both directions. In Tailwind: `fixed bottom-7 start-1/2` + conditional translate, or simpler: `left-1/2 -translate-x-1/2` (physical) since it's visually centered either way.

## 4. Brief-Generation Modal (`{{ generating }}`)

Overlay: `position: fixed; inset: 0; z-index: 100; background: rgba(15,25,45,.55); backdrop-filter: blur(6px); display: flex; align-items: center; justify-content: center;`

Dialog (carries its own `dir="{{ dir }}"`): `background: #fff; border-radius: 22px; padding: 40px 48px; width: 440px; max-width: 90vw; box-shadow: 0 30px 80px rgba(0,0,0,.3);`

**Header row** (`display:flex; align-items:center; gap:14px; margin-bottom:26px`):
- Spinner: `width: 40px; height: 40px; border: 3px solid #E4E9F1; border-top-color: #14969E; border-radius: 50%; animation: tq-spin 1s linear infinite; flex-shrink: 0;`
- Title `{{ t.generating }}`: `font-size: 17px; font-weight: 700; color: #14213A;`

**Steps column** (`display:flex; flex-direction:column; gap:14px`) — 4 steps from `[t.genStep1, t.genStep2, t.genStep3, t.genStep4]`. Each row `display:flex; gap:12px; align-items:center; opacity:{{ g.opacity }}`:
- Circle: `width: 22px; height: 22px; border-radius: 50%; font-size: 12px; font-weight: 700; flex; centered; flex-shrink: 0;`
- Label: `font-size: 14px; color: #2C3A54; font-weight: 500;`

State machine per step `i` vs `genStep`:
- **done** (`genStep > i`): mark `✓`, circle `bg #E9F6EF / fg #1F7A4D`, row opacity `1`
- **active** (`genStep === i`): mark `i+1`, circle `bg #E8F5F6 / fg #0E7A81`, row opacity `1`
- **pending**: mark `i+1`, circle `bg #F0F3F8 / fg #93A1B8`, row opacity `0.45`

**Timing** (`generateBrief()`): set `{ generating: true, genStep: 0 }`; then a `setTimeout` chain ticking every **850ms**, incrementing `genStep` to 1, 2, 3, 4; on the 5th tick (i = 5 > 4, i.e. ~4250ms total) set `{ generating: false, briefReady: true, cPage: 'brief' }` and `window.scrollTo({ top: 0 })`. So each step spends 850ms "active" before flipping to done.

Trigger: the `✦ {{ t.generateBrief }}` button shown in chat when `chatDone` (gradient button: `background: linear-gradient(120deg, #1B3568, #14969E); color:#fff; font-size:15px; font-weight:700; padding:14px 32px; border-radius:12px; box-shadow: 0 10px 26px rgba(20,150,158,.3);` hover `transform: translateY(-1px)`).

---

## 5. Shared / Repeated UI Patterns

### 5.1 Stat cards (client home, provider home, admin)

Grid: `display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px;` (margin-bottom 26–28px).
Card: `background: #fff; border: 1px solid #E4E9F1; border-radius: 16px; padding: 20px;`
- Label: `font-size: 13px; color: #7684A0; margin-bottom: 6px;`
- Value: `font-size: 27px; font-weight: 700; color: {per-stat};`

Data:
- Client (`clientStats`): `t.statActive` `'3'` navy; `t.statBriefsDone` `briefReady ? '5' : '4'` teal; `t.statProposals` `'7'` navy; `t.statSaved` `'26+'` `#8A6D33`.
- Provider (`providerStats`): `t.pStatOps` `'3'` teal; `t.pStatActive` `'2'` navy; `t.pStatRating` `'4.9 ★'` `#8A6D33`; `t.pStatResponse` `'92%'` navy.
- Admin row 1 (`adminStats1`, keys `t.aUsers/aClients/aProviders/aProjects`): all values navy, plus growth line `{{ t.monthGrowth }}` `font-size: 11.5px; color: #2FA36B; margin-top: 3px;`
- Admin row 2 (`adminStats2`) — **tinted stat card variant** with per-card bg/border/label-color/value-color:
  - `t.aWeekly`: `bg #fff / bd #E4E9F1 / label #7684A0 / value #1B3568`
  - `t.aBriefs`: `bg #E8F5F6 / bd #C6E7E9 / #0E7A81 / #0E7A81`
  - `t.aPending`: `bg #FDF9F0 / bd #EFE2C6 / #8A6D33 / #8A6D33`
  - `t.aMatchRate`: `bg #EEF3FB / bd #D5DDE9 / #1B3568 / #1B3568`
- Analytics KPI variant: `border-radius: 16px; padding: 22px;` value `font-size: 30px`; first card is the dark gradient `linear-gradient(150deg, #1B3568, #0F5E64)` white text, label `opacity: .75`.
- Small fact card (client/provider profile, 3-col grid `repeat(3,1fr) gap 14px`): `border-radius: 14px; padding: 16px 18px;` label `font-size:12px; color:#93A1B8; margin-bottom:3px`, value `font-size: 14.5–15px; font-weight: 700; color: #2C3A54;` (values that are emails/phones get `dir="ltr"` + `text-align: start`).

### 5.2 Tables (client projects, admin providers/projects/users/briefs)

Wrapper: `background: #fff; border: 1px solid #E4E9F1; border-radius: 18px; overflow: hidden;`

**Header row**: `padding: 13px 24px; display: grid; grid-template-columns: <per-table>; gap: 12px; background: #FAFBFD; border-bottom: 1px solid #EEF1F6; font-size: 12.5px; font-weight: 700; color: #7684A0;`

**Body row**: same grid template, `padding: 13–16px 24px; align-items: center; border-bottom: 1px solid #F3F5F9;` hover `background: #FAFBFD;` clickable rows add `cursor: pointer`.

Grid templates & header keys:
- Client projects: `2fr 1fr 1fr 1fr 1fr` — `thProject, thBudget, thTimeline, thStatus, thDate`
- Admin providers: `2fr 1fr 1fr 1fr 1.2fr 1fr` — `thProvider, thType, thCity, thRating, thPrice, thVerified`
- Admin projects: `2fr 1fr 1fr 1fr 1fr` — `thProject, thClient, thBudget, thStatus, thDate`
- Admin users: `2.2fr 1fr 1fr 1fr` — `thUser, thRole, thJoined, thStatus`
- Admin briefs: `2fr 1fr 1fr 1.2fr 1fr auto` — `thProject, thCategory, thDate, thQuality, thStatus` + empty `width: 76px` action column

Cell typography: primary cell = title `font-size: 13.5–14.5px; font-weight: 600;` + sub-line `font-size: 12–12.5px; color: #93A1B8;`; plain cells `font-size: 13–13.5px; color: #4A5A76;`; date cells `color: #93A1B8`. Chips in cells get `justify-self: start; white-space: nowrap`. Truncation on name/email cells: `white-space: nowrap; overflow: hidden; text-overflow: ellipsis;` with `min-width: 0` on parent.

Admin briefs extras: quality cell = progress track `flex:1; height:6px; background:#F0F3F8; border-radius:999px; overflow:hidden` with fill `width: q%; background: qColor` where `qColor = q >= 90 ? '#0E7A81' : '#8A6D33'`, plus `{{ b.q }}%` text `font-size:12.5px; font-weight:700` in `qColor`. Action button (`reviewBtn`/`closeBtn`): `background:#EEF3FB; color:#1B3568; font-size:12px; font-weight:700; padding:7px 16px; border-radius:999px; width:76px;` hover `background:#E1E9F6`. Expanded panel (`b.isOpen`, only row 0 toggles; others toast `t.demoOnly`): `background:#FAFBFD; border-bottom:1px solid #F3F5F9; padding:20px 24px;` showing summary + chips.

### 5.3 Client-home "recent projects" list variant

Section card `border-radius: 18px; overflow: hidden` with header `padding: 18px 24px; border-bottom: 1px solid #EEF1F6;` title `font-size:16px; font-weight:700` + link button `{{ t.viewAll }} ←` (`color: #14969E; font-size: 13.5px; font-weight: 600`, ghost). Rows: grid `2fr 1fr 1fr 1fr`, `padding: 15px 24px`, same hover/divider as tables (no header row).

### 5.4 Status chips — project statuses (the 6 variants, from `statusMap`)

Chip base (tables/rows): `font-size: 12px; font-weight: 600; padding: 4px 12px; border-radius: 999px; white-space: nowrap;` (project-detail header uses larger: `font-size: 13px; font-weight: 700; padding: 7px 18px`).

| status key | label key | bg | fg |
|---|---|---|---|
| `draft` | `t.stDraft` | `#F0F3F8` | `#7684A0` |
| `brief` | `t.stBrief` | `#EEF3FB` | `#1B3568` |
| `matched` | `t.stMatched` | `#E8F5F6` | `#0E7A81` |
| `selected` | `t.stSelected` | `#F7F0E3` | `#8A6D33` |
| `inprogress` | `t.stInprogress` | `#FDF9F0` | `#8A6D33` |
| `completed` | `t.stCompleted` | `#E9F6EF` | `#1F7A4D` |

Other chip families (same pill shape, `font-size 11–12.5px`):
- Verified: `t.verified`/`t.verifiedBadge` `#E9F6EF/#1F7A4D`; Unverified `t.unverified` `#F0F3F8/#93A1B8`.
- User active/suspended: `t.activeL` `#E9F6EF/#1F7A4D`; `t.suspendedL` `#FBEDEB/#B0433A`.
- Role chips (admin users, `roleChip`): client `#EEF3FB/#1B3568` (avatar color `#1B3568`), provider `#E8F5F6/#0E7A81` (avatar `#14969E`), admin label `t.roleAdminL` `#F7F0E3/#8A6D33` (avatar `#14213A`).
- Brief review status: approved `t.approvedTag` `#E9F6EF/#1F7A4D`; pending `t.pendingTag` `#FDF9F0/#8A6D33`.
- Skill chips (navy tint): `background:#EEF3FB; color:#1B3568; font-size:12–13px; font-weight:600; padding:3px 11px` (small) / `5px 13px` / `6px 14px` (large), radius 999px.
- Deliverable chips (teal tint w/ border): `background:#F2F7F9; border:1px solid #DCEBEE; color:#0E7A81; font-size:13px; font-weight:600; padding:6px 14px; border-radius:999px`.
- Info banner: `background:#F2F7F9; border:1px solid #DCEBEE; border-radius:12px; padding:10px 18px; font-size:12.5px; color:#0E7A81;` prefixed `ⓘ`.
- Warning note (opportunity/request cards): `font-size:13px; color:#6E5A31; background:#FDF9F0; border-radius:8px; padding:8px 13px; display:inline-block;` prefixed `ⓘ`.
- "Why match" callout: `background:#F2F7F9; border-inline-start:3px solid #14969E; border-radius:8px; padding:9px 14px; font-size:13px; color:#2C5B60;` bold lead `{{ t.whyMatch }}`.
- Type chip: `#F0F3F8/#4A5A76`, `font-size:11.5px; padding:2px 10px`.
- Received-time chip (provider requests): `#E8F5F6/#0E7A81; font-size:11.5px; font-weight:700; padding:2px 11px`.

### 5.5 Score blocks

Match score (client match cards / provider opportunity cards):
- Value: `font-size: 20–23px; font-weight: 700; color: {{ scoreColor }};` where `scoreColor = score >= 85 ? '#0E7A81' : score >= 78 ? '#8A6D33' : '#7684A0'` (provider cards use just `>= 85 ? '#0E7A81' : '#8A6D33'`), rendered as `{{ score }}%`.
- Caption below: `{{ t.matchScore }}` `font-size: 10.5–11px; color: #93A1B8;` centered.

Progress bars (repeated pattern): track `height: 6–9px; background: #F0F3F8 (or #EEF1F6 / rgba(255,255,255,.18) on dark); border-radius: 999px; overflow: hidden;` fill `height: 100%; width: N%; border-radius: 999px;` fill colors cycle `[#14969E, #1B3568, #C6A15B, ...]` for charts; complexity bar on dark card uses `#C6A15B`; profile completion uses `linear-gradient(90deg, #14969E, #1B3568)`.

Bar chart (analytics weekly): columns `flex:1`, bar `width:100%; max-width:34px; height: max(12, round(v/max*120))px; border-radius: 8px 8px 3px 3px;` color = `#1B3568` for the max value else `#8ED4D9`; value label above `font-size:11.5px; font-weight:700; color:#1B3568`, day below `font-size:11px; color:#93A1B8`.

### 5.6 Avatar tiles (initial-letter blocks)

All are flex-centered, `color: #fff; font-weight: 700;` background = entity color:
- Topbar avatar: `34px`, `border-radius: 50%`, font 14px (role-colored, see §1.1).
- Match card provider tile: `58px × 58px; border-radius: 16px; font-size: 23px;` bg `{{ p.color }}`.
- Requested-provider mini tile: `36px; border-radius: 11px; font-size: 15px;`
- Table provider tile: `34px; border-radius: 10px; font-size: 14px;`
- Table user avatar: `34px; border-radius: 50%; font-size: 13px;` bg from role color.
- Profile hero tile: `72px; border-radius: 20px; font-size: 30px;` bg `#1B3568` (client `أ`, provider `ع`).
- Chat AI tile: `42px; border-radius: 13px; background: linear-gradient(135deg, #1B3568, #14969E); font-size: 17px;` letter `ت`.

### 5.7 Buttons

- **Primary (navy)**: `background: #1B3568; color: #fff; border: none; font-weight: 600–700; border-radius: 10–11px; padding: ~11px 18–24px; font-size: 13.5–15px;` hover `background: #24437F`. Large CTAs add `box-shadow: 0 4px 14px rgba(27,53,104,.25)` (nav) or `0 6px 16px rgba(27,53,104,.25)` (approve brief).
- **Primary (teal)**: `background: #0E7A81; color: #fff;` hover `background: #14969E` (provider Accept). Signup submit uses role color (`#0E7A81` provider / `#1B3568` client), `width:100%; padding:13px; border-radius:11px; font-weight:700`, hover `opacity:.93`.
- **Gradient CTA**: `linear-gradient(120deg, #1B3568, #14969E)`, `padding: 14px 32px; border-radius: 12px; box-shadow: 0 10px 26px rgba(20,150,158,.3);` hover `translateY(-1px)`. (White-on-gradient variant on client home banner: `background:#fff; color:#1B3568; padding:13px 26px; border-radius:11px; box-shadow: 0 6px 18px rgba(0,0,0,.15)`.)
- **Secondary (outlined)**: `background: #fff; color: #1B3568; border: 1.5px solid #D5DDE9; font-weight: 600; padding: 10–11px 18–20px; border-radius: 10px;` hover `border-color: #1B3568`.
- **Ghost / link**: `background: none; border: none;` teal link `color: #14969E; font-size: 13–13.5px; font-weight: 600–700`; muted link `color: #7684A0` hover `color: #1B3568`.
- **Soft (gray pill/block)**: `background: #F0F3F8; color: #1B3568; border: none; padding: 11px 20px; border-radius: 10px; font-weight: 600;` hover `background: #E4E9F1`. Navy-tint variant `background:#EEF3FB` hover `#E1E9F6`.
- **Danger (soft)**: `background: #FBEDEB; color: #B0433A;` hover `background: #F6DEDA` (delete account; admin reject pill uses same colors at `font-size:12px; padding:6px 14px; border-radius:999px`). Approve pill: `#E9F6EF/#1F7A4D` hover `#D7EEDF`.
- **Decline (outlined danger-on-hover)**: `background:#fff; color:#7684A0; border:1.5px solid #E4E9F1;` hover `border-color:#B0433A; color:#B0433A`.
- **Chat suggestion chips**: `background:#fff; border:1.5px solid #C6E7E9; color:#0E7A81; font-size:13.5px; font-weight:600; padding:10px 18px; border-radius:999px;` hover `background:#E8F5F6; border-color:#14969E`.
- **Segmented pill toggle** (role switcher, chat mode, settings language): container `background:#F0F3F8; border-radius:999px; padding:3–4px; gap:2px;` active segment `background:#fff` + role color text + `box-shadow: 0 2px 6px rgba(20,40,80,.12)`; inactive `transparent / #7684A0`.
- **Resolved-state blocks** (non-interactive button replacements): `font-size:13px; font-weight:700; padding:11px 18px; border-radius:10px; text-align:center;` — success `#E9F6EF/#1F7A4D` (e.g. `t.proposalRequested ✓`, `t.accepted`, `t.reqSentLbl`), declined `#F0F3F8/#93A1B8` (`t.declined`).

### 5.8 Section cards

Default content card: `background: #fff; border: 1px solid #E4E9F1; border-radius: 18px; padding: 22–26px;` (smaller cards 14px radius / 16–18px padding). Card section title: `font-size: 14–15px; font-weight: 700; margin-bottom: 12–18px;` Eyebrow/label style: `font-size: 12.5px; font-weight: 700; color: #93A1B8; letter-spacing: .05em;` Inner divider: `height: 1px; background: #EEF1F6; margin: 20px 0;`

Dark gradient summary card (brief sidebar / analytics KPI): `background: linear-gradient(150deg, #1B3568, #0F5E64); border-radius: 18px (16px KPI); padding: 24px; color: #fff;` labels at `opacity: .7`, dividers `rgba(255,255,255,.15)`.

Warning card (missing info): `background: #FDF9F0; border: 1px solid #EFE2C6; border-radius: 18px; padding: 22px;` title `#8A6D33`, items `#6E5A31` prefixed `؟`.

Hover-elevate card (match cards): hover `box-shadow: 0 10px 28px rgba(20,40,80,.08); border-color: #C6E7E9;`

Two-column detail layouts: brief `grid-template-columns: 1.6fr 1fr; gap: 18px; align-items: start;`; project detail `1.5fr 1fr`; admin overview `1.2fr 1fr`.

### 5.9 Page title pattern

- H1: `font-size: 24px (brief 26px, matches/detail 25px); font-weight: 700; margin: 0 0 4px;` (or `0 0 20px` when no subtitle).
- Subtitle p: `color: #7684A0; margin: 0; font-size: 14.5px;` (admin overview 13.5px).
- Optional teal eyebrow above title: `✦ {{ t.briefKicker }}` — `font-size: 12.5px; font-weight: 700; color: #14969E; letter-spacing: .04em; margin-bottom: 6px;`
- Header rows with actions: `display: flex; align-items: flex-end|flex-start; justify-content: space-between; gap: 16px; margin-bottom: 20–22px; flex-wrap: wrap;`
- Back link (detail): ghost, `color: #7684A0; font-size: 13.5px; font-weight: 600; margin-bottom: 14px;` hover navy — `{{ t.backToProjects }}`.
- H2 sub-section: `font-size: 18px; font-weight: 700; margin: 0 0 3px;` + 13.5px muted sub.

### 5.10 Timelines / steppers

- **Milestone timeline** (brief + detail): rows `display:flex; gap:16px`; rail = dot `11px; border-radius:50%; background:#14969E; margin-top:5px` + connector `width:2px; flex:1; background:#DCEBEE` (omitted on last item via `m.line`); content `padding-bottom:18px`, title `font-size:13px; font-weight:700; color:#0E7A81`, desc `font-size:14px; color:#4A5A76`.
- **Activity timeline**: dot `9px; background:#C9D3E2; margin-top:6px`, connector `#EEF1F6`, time `font-size:11.5px; color:#93A1B8`, text `13.5px #2C3A54`.
- **Horizontal project stepper** (`pdStepItems`, 5 steps from `t.pdSteps`; current step = 3 if any proposal requested else 2): circle `30px; border-radius:50%; font-size:13px; font-weight:700` — done `bg #14969E / fg #fff / mark ✓`, active `bg #1B3568 / fg #fff / number`, pending `bg #fff / fg #93A1B8 / border 2px solid #E4E9F1`; label under circle `font-size:12px; weight 700 if active else 500; color #14213A (done/active) or #93A1B8`, `min-width:90px` column; connector line `flex:1; height:3px; border-radius:999px; margin-top:14px;` color `#14969E` if fully passed else `#EEF1F6`; segment flex `1` except last `0 0 auto`.

### 5.11 Empty states

Small inline empty state (project detail "no providers requested", `noRequested`): muted text `{{ t.pdNoProviders }}` `font-size: 13.5px; color: #7684A0; margin-bottom: 12px;` + soft CTA button `{{ t.pdGoMatches }}` (`background:#EEF3FB; color:#1B3568; font-weight:700; font-size:13px; padding:10px 18px; border-radius:10px;` hover `#E1E9F6`). There is no large illustration-style empty state in the prototype; use this text+soft-button pattern for empties.

### 5.12 Form inputs (public + app)

- Field label: `font-size: 13px; font-weight: 600; color: #4A5A76; margin-bottom: 6px;`
- Input: `width:100%; border: 1.5px solid #E4E9F1; border-radius: 10px; padding: 11px 14px; font-size: 14px; outline: none; background: #FBFCFE;` focus → `border-color: #14969E`. Email/phone/password inputs are forced `dir="ltr"`.
- Chat composer input: `border-radius: 11px; padding: 12px 16px; font-size: 14.5px;` same colors; send button = primary navy `padding: 12px 24px; border-radius: 11px`.
- Editing inputs (brief edit mode): `border: 1.5px solid #14969E`.
- Toggle switch (settings `notifItems`): button `width:44px; height:25px; border-radius:999px; transition: background .2s;` bg on `#14969E` / off `#D5DDE9`; knob `position:absolute; top:3px; inset-inline-start: 22px (on) / 3px (off); width:19px; height:19px; border-radius:50%; background:#fff; box-shadow:0 1px 4px rgba(0,0,0,.25); transition: inset-inline-start .2s;`

### 5.13 Chat bubbles (for completeness — shared bubble pattern)

Bubble: `max-width:78%; padding:13px 18px; font-size:14.5px; line-height:1.8; box-shadow:0 2px 8px rgba(20,40,80,.05); white-space:pre-wrap; animation: tq-rise .3s ease both;`
- AI: aligned `flex-start`, `bg #fff; fg #2C3A54; border 1px solid #E4E9F1; radius 4px 16px 16px 16px`.
- User: aligned `flex-end`, `bg #1B3568; fg #fff; no border; radius 16px 4px 16px 16px`.
- Typing indicator: white bordered pill `padding:14px 20px` with three `7px` teal dots, `tq-blink 1.2s` at delays `0/.2s/.4s`.
- Chat canvas: `background:#FBFCFE; border-inline:1px solid #E4E9F1; padding:24px 22px; overflow-y:auto; gap:16px` — auto-scrolls to bottom 60ms after each message.

### 5.14 Misc repeated bits

- Green "online" dot: `7px; border-radius: 50%; background: #2FA36B;`
- Diamond bullet (services list): `7px square, border-radius: 2px, background: #14969E, transform: rotate(45deg)`.
- Numbered scope bullet: `20px square; border-radius: 6px; background: #EEF3FB; color: #1B3568; font-size: 11.5px; font-weight: 700;`
- Portfolio placeholder thumb: `44px; border-radius: 10px; background: repeating-linear-gradient(45deg, #EEF3FB, #EEF3FB 6px, #E1E9F6 6px, #E1E9F6 12px);` row hover `border-color: #14969E`.
- Skill chip w/ count (admin cats): outer `inline-flex; gap:8px; background:#FBFCFE; border:1px solid #E4E9F1; border-radius:999px; padding:6px 7px 6px 14px;` name span `dir="ltr" font-size:13px; font-weight:600; color:#2C3A54` + count pill `font-size:11px; color:#7684A0; background:#F0F3F8; padding:2px 10px; border-radius:999px`.
- Category card: `border-radius:14px; padding:18px 20px;` name `14.5px/700/#2C3A54`, count `12.5px/#93A1B8` + ` {{ t.catProject }}`.
- Gradient promo banner (client home): `linear-gradient(120deg, #1B3568, #14969E 140%); border-radius: 18px; padding: 26px 30px; color: #fff;` title 19px/700, sub 13.5px at `opacity:.8`.
- Directional arrows are computed: `arrowChar = ar ? '←' : '→'`; several buttons hard-code `←`/`↗` glyphs next to labels.

---

## 6. State & Data Model Notes (for handlers)

Component state (from `data-dc-script`): `lang` (null → falls back to prop `defaultLang`, default `'ar'`), `view: 'landing'|'app'`, `role: 'client'|'provider'|'admin'`, `cPage`, `pPage`, `aPage`, `pubPage`, `signupRole`, chat state (`messages, step, typing, chatDone, started, draft, liveMode, liveHistory`), `generating/genStep/briefReady`, `editing/edits`, interaction maps `proposals/ops/pending/reqs/notif/briefOpen`, `toast`. Data is lazy-loaded from `talaqi-data.js` (exports `I18N`, `CHAT_SCRIPT`, `CHAT_DONE`, `BRIEF`, `PROVIDERS`, `MATCHES`, `PROJECTS`, `OPPORTUNITIES`, `REQUESTS`, `USERS`, `BRIEFS_LIST`, `ADMIN`, `ANALYTICS`, `CATEGORIES`, `SKILLS`); until loaded, `t` proxies to empty strings and lists are empty arrays.

Navigation helpers: `set(patch)` = setState + `window.scrollTo({top: 0})`. Role deep-links from landing: `demoAsClient/Provider/Admin` and `openClient/openProvider`.

i18n keys referenced by the shells (must exist in `I18N.ar` and `I18N.en`): `brand, demoMode, langBtn, backToSite, tagline, roleClient, roleProvider, roleAdmin, roleAdminL, clientName, clientPerson, navHow, navClients, navProviders, navAbout, navPricing, navContact, navCats, login, startCta, positioning, footerLinks1, footerLinks2, footerAbout, footerContact, footerTerms, footerRights, footerMade, cNavHome, cNavNew, cNavBrief, cNavMatches, cNavProjects, cNavSettings, cpTitle, pNavHome, pNavRequests, pNavProfile, pNavSettings, aNavOverview, aNavUsers, aNavProviders, aNavProjects, aNavBriefs, aNavAnalytics, aNavCats, aNavSettings, generating, genStep1..genStep4, generateBrief, stDraft, stBrief, stMatched, stSelected, stInprogress, stCompleted, verified, unverified, verifiedBadge, activeL, suspendedL, approvedTag, pendingTag, matchScore, whyMatch, viewAll, demoOnly` (+ per-screen keys documented in the screen specs).
