# Talaqi Public Screens — Implementation Spec

Source: `Talaqi Platform.dc.html` lines 28–616. Target stack: Next.js 15 + TypeScript + Tailwind.

## 0. Global Conventions

### Template syntax mapping (prototype → Next.js)
- `{{ t.key }}` → i18n lookup (`useTranslations()` / dictionary object keyed by locale). Arabic (`ar`) is the **default locale**.
- `{{ handler }}` → event handler (navigation/state functions defined in `support.js`; re-implement as router pushes / state setters).
- `<sc-if value="{{ cond }}">` → conditional render (`{cond && (...)}`).
- `<sc-for list="{{ arr }}" as="x">` → `{arr.map(x => ...)}`.
- `style-hover="..."` → hover styles (Tailwind `hover:` or CSS class). `style-focus="..."` → focus styles.
- `dir="{{ dir }}"` → `rtl` when Arabic, `ltr` when English. `dir="{{ dirOpp }}"` → the opposite direction (used on English subtitle text inside Arabic pages).
- All spacing uses **CSS logical properties** (`margin-inline-start`, `inset-inline-start`, `border-inline-end`, `text-align: start/end`) — never left/right, so RTL works automatically.

### Root wrapper (line 28)
```
<div dir={dir} style: font-family: 'IBM Plex Sans Arabic', system-ui, sans-serif;
  color: #1A2438; background: #F6F8FB; min-height: 100vh;
  font-size: 15px; line-height: 1.7;>
```
Load Google font **IBM Plex Sans Arabic** (weights 400/500/600/700).

### Color palette (recurring tokens)
| Token | Value | Usage |
|---|---|---|
| Navy primary | `#1B3568` | Primary buttons, brand text, headings accents |
| Navy hover | `#24437F` | Primary button hover |
| Navy darkest | `#14213A` | Dark bands, footer, headings |
| Deep heading | `#14213A` | h1/h2 color |
| Teal accent | `#14969E` | Accent color, links, focus borders |
| Teal dark | `#0E7A81` | Provider CTA, success text |
| Teal darker | `#0F5E64` | Gradient end |
| Teal light bg | `#E8F5F6` | Badge/check backgrounds |
| Teal light border | `#C6E7E9` | Badge borders |
| Teal bright | `#7FE3E9` | Light accents on dark bg |
| Teal wash | `#F2F7F9` / `#DCEBEE` | Hero gradient stop / sidebar card |
| Gold | `#C6A15B` | "Popular" badge, gradient connector |
| Gold text | `#8A6D33` | Provider pill text |
| Gold bg | `#F7F0E3` | Provider pill bg (hover `#F0E5CC`) |
| Red text | `#B0433A` | Problem section |
| Red bg | `#FBEDEB` | Problem ✕ chips |
| Body text | `#4A5A76` | Paragraphs |
| Body text 2 | `#2C3A54` | Value list items |
| Nav text | `#3D4C68` | Nav links |
| Muted | `#7684A0` | Secondary text |
| Muted light | `#93A1B8` | Tertiary/caption text |
| Border | `#E4E9F1` | All card/nav borders |
| Border input hairline | `#EEF1F6` | Divider lines (login) |
| Hover bg | `#F0F3F8` | Nav link hover, chips |
| Input bg | `#FBFCFE` | All inputs |
| Card bg | `#EEF3FB` | "For clients" pill bg |
| Footer link | `#C4CFE2` | Footer links |
| Footer muted | `#8A9AB8` / `#6B7C9E` | Footer headings / copyright |
| Dark strip arrow | `#3D5378` | Pipeline arrows |
| Page bg | `#F6F8FB` | Body |

### Animations (define in global CSS)
- `tq-rise`: used as `animation: tq-rise .7s ease both` on the hero pipeline mock column. Implement as rise-in: `from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; }` (approx; keyframes defined in prototype CSS outside these lines — a fade+rise entrance).
- `tq-pulse`: `animation: tq-pulse 1.6s infinite` on 7px dot — pulsing opacity/scale (`0%,100% { opacity: 1 } 50% { opacity: .35 }` style pulse).

### Shared state variables (from support.js)
- `dir` / `dirOpp` — text direction pair.
- Nav active state: `wClients/cClients`, `wProviders/cProviders`, `wAbout/cAbout`, `wContact/cContact` — font-weight (`500` inactive / `700` active) and color (`#3D4C68` inactive / active likely `#1B3568`) for each public nav item depending on current public page.
- Page flags: `isLanding` (outer, includes all public pages + footer), `isPubHome`, `isPubAbout`, `isPubClients`, `isPubProviders`, `isPubContact`, `isPubLogin`, `isPubSignup`, `isApp`.
- `arrowChar` — direction-aware arrow glyph for pipeline strips (← in RTL, → in LTR).
- `briefTitle`, `heroTimeline`, `heroMatchName`, `heroMatchRole` — localized demo strings for the hero mock.

### Handlers referenced across public screens
`goTop`, `scrollHow`, `scrollPricing`, `scrollCats`, `goPubClients`, `goPubProviders`, `goPubAbout`, `goPubContact`, `goLogin`, `goSignupC` (signup as client), `goSignupP` (signup as provider), `toggleLang`, `contactSend`, `demoAsClient`, `demoAsProvider`, `demoAsAdmin`, `suSetClient`, `suSetProvider`, `suSubmit`, `goLanding`.

---

## 1. Shared Public NAV (rendered on all public screens, inside `isLanding`)

Sticky header:
- Outer: `position: sticky; top: 0; z-index: 50; background: rgba(255,255,255,.92); backdrop-filter: blur(12px); border-bottom: 1px solid #E4E9F1;`
- Inner container: `max-width: 1180px; margin: 0 auto; padding: 14px 24px; display: flex; align-items: center; gap: 24px;`

Contents, in order:
1. **Brand block** (`onClick={goTop}`, cursor pointer): flex, gap 10px; logo `assets/logo-mark.png` 36×35px `object-fit: contain`; brand name `{{ t.brand }}` — 700 / 19px / `#1B3568` / line-height 1.2.
2. **Nav links** — flex, `gap: 4px; margin-inline-start: auto; align-items: center;`. Each button: no bg/border, font 14px, padding `8px 10px`, radius 8px, hover `background: #F0F3F8`. In order:
   - `t.navHow` → `scrollHow` (weight 500, color #3D4C68 fixed)
   - `t.navClients` → `goPubClients` (weight `{{wClients}}`, color `{{cClients}}`)
   - `t.navProviders` → `goPubProviders` (dynamic w/c)
   - `t.navAbout` → `goPubAbout` (dynamic w/c)
   - `t.navPricing` → `scrollPricing` (500 / #3D4C68 fixed)
   - `t.navContact` → `goPubContact` (dynamic w/c)
3. **Actions** — flex, gap 10px:
   - Lang toggle `t.langBtn` → `toggleLang`: bg `#F0F3F8`, border `1px solid #E4E9F1`, 13px/600, color `#1B3568`, padding `7px 14px`, radius 999px, hover bg `#E4E9F1`.
   - Login `t.login` → `goLogin`: text-only, 14px/600, `#1B3568`, padding `8px 12px`.
   - Primary CTA `t.startCta` → `goSignupC`: bg `#1B3568`, white text, 14px/600, padding `10px 20px`, radius 10px, `box-shadow: 0 4px 14px rgba(27,53,104,.25)`, hover bg `#24437F`.

Note: `scrollHow`/`scrollPricing`/`scrollCats` scroll to landing anchors `#tq-how`, `#tq-pricing`, `#tq-cats` (should navigate home first if on another public page).

---

## 2. LANDING PAGE (`isPubHome`)

### 2.1 HERO section
Wrapper: `background: linear-gradient(180deg, #FFFFFF 0%, #F2F7F9 70%, #F6F8FB 100%); border-bottom: 1px solid #E4E9F1;`

Grid container: `max-width: 1180px; margin: 0 auto; padding: 84px 24px 72px; display: grid; grid-template-columns: 1.1fr .9fr; gap: 56px; align-items: center;` (responsive: collapse to 1 column below ~1024px).

**Left column (copy):**
1. Badge pill: `inline-flex; align-items: center; gap: 8px; background: #E8F5F6; border: 1px solid #C6E7E9; color: #0E7A81; font-size: 13px; font-weight: 600; padding: 6px 14px; border-radius: 999px; margin-bottom: 22px;` containing a 7×7px round dot `background: #14969E` + `t.heroBadge`.
2. H1: `font-size: 46px; line-height: 1.35; font-weight: 700; margin: 0 0 18px; color: #14213A;` — `t.heroTitle1` then `<br/>` then `<span style="color:#14969E">{t.heroTitle2}</span>`.
3. Subhead `t.heroSub`: 17px, `#4A5A76`, `margin: 0 0 10px; max-width: 540px;`.
4. English sub `t.heroSubEn` with `dir={dirOpp}`: 13.5px, `#93A1B8`, `margin: 0 0 30px; max-width: 540px;`.
5. CTA row: flex, gap 14px, wrap.
   - `t.startCta` → `goSignupC`: bg `#1B3568`, white, 16px/600, padding `15px 30px`, radius 12px, `box-shadow: 0 8px 24px rgba(27,53,104,.3)`; hover: `background:#24437F; transform: translateY(-1px);`.
   - `t.joinCta` → `goSignupP`: bg `#fff`, color `#1B3568`, `border: 1.5px solid #D5DDE9`, 16px/600, padding `15px 30px`, radius 12px; hover: `border-color: #1B3568`.
6. Stats row: flex, gap 36px, `margin-top: 44px`. Three stat blocks separated by 1px-wide dividers (`width:1px; background:#E4E9F1` full-height flex items):
   - `+380` (26px/700/#1B3568) over `t.statBriefs` (13px/#7684A0)
   - `+320` (26px/700/#1B3568) over `t.statProviders`
   - `87%` (26px/700/**#14969E**) over `t.statMatch`

**Right column — hero pipeline mock** (`display:flex; flex-direction:column; gap:14px; animation: tq-rise .7s ease both;`):
1. **Card A (user request)**: white card — `border: 1px solid #E4E9F1; border-radius: 16px; padding: 18px 20px; box-shadow: 0 12px 32px rgba(20,40,80,.08); display:flex; gap:12px; align-items:flex-start;`
   - Avatar tile: 34×34px, radius 10px, bg `#F0F3F8`, centered bold `#1B3568` letter **"أ"**, `flex-shrink: 0`.
   - Text stack: label `t.pipe1` (12px, `#93A1B8`, mb 2px); quoted message `"{t.chatStarter1}"` (14.5px / 500) — note literal surrounding quote marks.
2. **Connector**: centered flex containing `width:2px; height:18px; background: linear-gradient(#14969E, #C6E7E9);`.
3. **Card B (AI brief, gradient)**: `background: linear-gradient(135deg, #1B3568, #14969E); border-radius: 16px; padding: 18px 20px; box-shadow: 0 16px 40px rgba(20,150,158,.28); color:#fff;`
   - Header row: flex, gap 8px, 12px font, `opacity:.85`, mb 8px — pulsing 7×7px round dot `background:#7FE3E9; animation: tq-pulse 1.6s infinite;` + text `{t.pipe3} — AI`.
   - Title `{briefTitle}`: 15px/600, mb 10px.
   - Chip row (flex, gap 8px, wrap): two chips `background: rgba(255,255,255,.16); border-radius: 999px; padding: 3px 12px; font-size: 12px;` — first: `{t.bBudget}: 4,000–8,000`; second: `{heroTimeline}`.
4. **Connector 2**: same 2×18px bar but `background: linear-gradient(#C6E7E9, #C6A15B);` (teal→gold).
5. **Card C (match result)**: white card — `border:1px solid #E4E9F1; border-radius:16px; padding:16px 20px; box-shadow: 0 12px 32px rgba(20,40,80,.08); display:flex; align-items:center; gap:12px;`
   - Avatar: 40×40px, radius 12px, bg `#1B3568`, white bold letter **"ع"**, flex-shrink 0.
   - Middle (`flex:1`): `{heroMatchName}` 14.5px/600; `{heroMatchRole}` 12.5px `#7684A0`.
   - Score block (text-align center): **94%** 18px/700/`#0E7A81` over `t.matchScore` 11px `#93A1B8`.

### 2.2 Dark 5-step pipeline strip
Container: `max-width: 1180px; margin: 0 auto; padding: 0 24px 56px;` (still inside hero gradient wrapper).
Strip: `background: #14213A; border-radius: 18px; padding: 22px 32px; display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap;`

Loop `pipeSteps` (5 items, each `{ n, label, arrow }`):
- Item: flex, gap 12px → inner flex gap 10px:
  - Number badge: 30×30px circle, `background: rgba(20,150,158,.25); color: #7FE3E9;` 13.5px/700, centered.
  - Label `{p.label}`: white, 14.5px/600.
- If `p.arrow` (true for steps 1–4): trailing arrow span `color: #3D5378; font-size: 16px;` rendering `{arrowChar}` (direction-aware: `←` in RTL / `→` in LTR).

### 2.3 PROBLEM / SOLUTION split
Container: `max-width:1180px; margin:0 auto; padding: 88px 24px 0;`
Grid: `grid-template-columns: 1fr 1fr; gap: 28px; align-items: stretch;`

**Left card — Problem (white):** `background:#fff; border:1px solid #E4E9F1; border-radius:20px; padding:36px;`
- Kicker: 12.5px/700, color `#B0433A`, `letter-spacing: .04em`, mb 10px — text: `{t.oldJourney} — {t.oldSteps}`.
- H2 `t.problemTitle`: 26px/700, `margin: 0 0 20px`, `#14213A`.
- List: flex column, gap 14px. Loop `problems` (4 items `{ text }`): row flex gap 12px, align flex-start:
  - ✕ chip: 22×22px circle, bg `#FBEDEB`, color `#B0433A`, 13px/700, centered, `flex-shrink:0; margin-top:3px;` — glyph `✕`.
  - Text `{pr.text}`: `#4A5A76`, 15px.

**Right card — Solution (gradient):** `background: linear-gradient(160deg, #1B3568, #0F5E64); border-radius:20px; padding:36px; color:#fff; display:flex; flex-direction:column;`
- Kicker: 12.5px/700, color `#7FE3E9`, letter-spacing .04em, mb 10px — `{t.newJourney} — {t.newSteps}`.
- H2 `t.solutionTitle`: 26px/700, `margin: 0 0 20px`.
- Paragraph `t.positioning`: 15.5px, line-height 1.9, `rgba(255,255,255,.85)`, margin 0.
- Bottom (pushed with `margin-top:auto; padding-top:28px;`): button `t.startCta` → `goSignupC` — bg `#fff`, color `#1B3568`, 15px/700, padding `13px 26px`, radius 11px; hover `transform: translateY(-1px)`.

### 2.4 HOW IT WORKS (`id="tq-how"`)
Container: `max-width:1180px; margin:0 auto; padding: 96px 24px 0;`
- Header (centered, mb 48px): H2 `t.howTitle` 32px/700 `#14213A` `margin:0 0 8px`; sub `t.howSub` `#7684A0` 16px.
- Grid: `repeat(5, 1fr); gap: 18px;` (responsive: 2–3 cols on tablet, 1 on mobile).
- Loop `howSteps` (5 items `{ n, t, d, tileBg, tileFg }`). Card: `background:#fff; border:1px solid #E4E9F1; border-radius:18px; padding: 26px 22px; position:relative;`
  - Hover: `box-shadow: 0 12px 30px rgba(20,40,80,.1); transform: translateY(-3px); transition: all .2s;`
  - Number tile: 38×38px, radius 12px, `background: {h.tileBg}; color: {h.tileFg};` 16px/700, centered, mb 16px — data-driven per-step colors.
  - Title `{h.t}`: 15.5px/700, mb 6px, `#14213A`.
  - Desc `{h.d}`: 13.5px, `#7684A0`, line-height 1.7.

### 2.5 VALUE grid (clients vs providers)
Container: `max-width:1180px; margin:0 auto; padding: 96px 24px 0;`
- H2 `t.valueTitle`: 32px/700, `margin: 0 0 40px`, `#14213A`, centered.
- Grid: `1fr 1fr; gap: 28px;`

**Card 1 (clients):** white, border `#E4E9F1`, radius 20px, padding 34px.
- Pill: `inline-block; background:#EEF3FB; color:#1B3568; 13px/700; padding: 6px 16px; radius 999px; mb 20px;` — `t.forClients`.
- List: flex-col gap 13px, loop `clientVals` (4 × `{ text }`): row flex gap 12px center — ✓ chip 22×22px circle bg `#E8F5F6` color `#0E7A81` 12px/700 flex-shrink 0; text 15.5px `#2C3A54` weight 500.

**Card 2 (providers):** identical except pill: `background:#F7F0E3; color:#8A6D33;` — `t.forProviders`; loop `providerVals` (4) with same teal ✓ chips.

### 2.6 FEATURES (`id="tq-features"`) — 8 cards
Container: `max-width:1180px; margin:0 auto; padding:96px 24px 0;`
- Header centered mb 48px: H2 `t.featuresTitle` 32px/700; sub `t.featuresSub` `#7684A0` 16px.
- Grid: `repeat(4, 1fr); gap: 18px;` (8 items → 2 rows).
- Loop `features` (8 × `{ t, d, dot }`). Card: white, border `#E4E9F1`, radius 18px, padding 24px; hover: `border-color: #14969E; transition: all .2s;`
  - Diamond dot: `width:12px; height:12px; border-radius:4px; background:{f.dot}; margin-bottom:16px; transform: rotate(45deg);` (color per feature).
  - Title `{f.t}`: 15px/700, mb 5px, `#14213A`.
  - Desc `{f.d}`: 13px, `#7684A0`.

### 2.7 CATEGORIES (`id="tq-cats"`) — 16 cards
Container: `max-width:1180px; margin:0 auto; padding:96px 24px 0;`
- Header centered mb 42px: H2 `t.catsTitle` 32px/700; sub `t.catsSub`.
- Grid: `repeat(4, 1fr); gap: 14px;` (16 items → 4 rows).
- Loop `cats` (16 × `{ name, count }`). Card: white, border `#E4E9F1`, radius 14px, `padding: 16px 20px; display:flex; align-items:center; justify-content:space-between; gap:10px; cursor:pointer;`
  - Hover: `border-color: #1B3568; box-shadow: 0 6px 18px rgba(20,40,80,.07);`
  - Name: 14.5px/600, `#2C3A54`.
  - Count: 12px, `#93A1B8`, `white-space:nowrap` — text `{c.count} {t.catProject}` (e.g. "24 مشروع").

Note: the `cats` list is reused in the signup provider specialty `<select>`.

### 2.8 PRICING (`id="tq-pricing"`) — 4 tiers
Container: `max-width:1180px; margin:0 auto; padding: 96px 24px 0;`
- Header centered mb 48px: H2 `t.pricingTitle` 32px/700; sub `t.pricingSub`.
- Grid: `repeat(4, 1fr); gap: 18px; align-items: stretch;`
- Loop `plans` (4). Plan shape: `{ n, p, per, hot, bg, border, fg, check, btnBg, btnFg, btnBorder, featList[], go, cta }` — visual styling is **fully data-driven** per tier (one tier is a dark/highlighted card; others white).
- Card: `background:{pl.bg}; border:{pl.border}; border-radius:20px; padding: 30px 26px; display:flex; flex-direction:column; position:relative; color:{pl.fg};`
  - **Popular badge** (`sc-if pl.hot`, only on the highlighted tier): `position:absolute; top:-12px; inset-inline-start:24px; background:#C6A15B; color:#fff; font-size:11.5px; font-weight:700; padding:4px 14px; border-radius:999px;` — `t.popular`.
  - Plan name `{pl.n}`: 16px/700, mb 14px.
  - Price row: flex baseline gap 6px, mb 22px — price `{pl.p}` 36px/700; period `{pl.per}` 13px, `opacity:.65`.
  - Feature list: flex-col gap 11px, mb 26px. Loop `pl.featList` (~4 × `{ text }`): row flex gap 10px align flex-start, 13.5px — ✓ span `color:{pl.check}; font-weight:700;`; text `opacity:.88`.
  - CTA button (`margin-top:auto`): `background:{pl.btnBg}; color:{pl.btnFg}; border:{pl.btnBorder};` 14px/700, padding 12px, radius 11px, hover `opacity:.92` — `onClick={pl.go}`, label `{pl.cta}`.

### 2.9 CLOSING CTA band
Container: `max-width:1180px; margin:0 auto; padding: 96px 24px;` (bottom padding included).
Band: `background: linear-gradient(135deg, #14213A, #1B3568 55%, #14969E 130%); border-radius:24px; padding: 64px 40px; text-align:center; color:#fff;`
- H2 `t.closingTitle`: 34px/700, `margin:0 0 12px`, line-height 1.5.
- Sub `t.closingSub`: 16px, `rgba(255,255,255,.75)`, `margin:0 0 32px`.
- Button row (flex, gap 14px, center, wrap):
  - `t.startCta` → `goSignupC`: bg `#fff`, color `#1B3568`, 16px/700, padding `15px 32px`, radius 12px; hover `translateY(-1px)`.
  - `t.joinCta` → `goSignupP`: `background: rgba(255,255,255,.12); border:1px solid rgba(255,255,255,.35); color:#fff;` 16px/600, same padding/radius; hover `background: rgba(255,255,255,.2)`.

---

## 3. ABOUT (`isPubAbout`)
Wrapper: `max-width:1180px; margin:0 auto; padding: 76px 24px 96px;`

1. **Header block** (centered, `max-width:760px; margin:0 auto 56px;`):
   - Kicker `t.aboutKicker`: 13px/700, `#14969E`, `letter-spacing: .05em`, mb 12px.
   - H1 `t.aboutTitle`: 40px/700, `margin:0 0 18px`, `#14213A`, line-height 1.4.
   - Lead `t.aboutLead`: 16.5px, `#4A5A76`, line-height 1.9.
2. **Mission / Vision grid**: `1fr 1fr; gap:24px; margin-bottom:24px;` Two white cards (border `#E4E9F1`, radius 20px, padding 34px):
   - Mission: diamond dot 12×12px radius 4px rotate(45deg) `background:#14969E`, mb 18px; title `t.aboutMissionT` 18px/700 mb 8px; body `t.aboutMission` 15px `#4A5A76` lh 1.9.
   - Vision: same but dot `background:#C6A15B`; `t.aboutVisionT` / `t.aboutVision`.
3. **Positioning band**: `background: linear-gradient(135deg, #14213A, #1B3568 60%, #0F5E64 140%); border-radius:20px; padding: 40px 44px; color:#fff; margin-bottom:56px; display:flex; align-items:center; gap:28px; flex-wrap:wrap;`
   - Logo tile: white box radius 14px padding 10px, flex-shrink 0, containing logo img 44×43px.
   - Quote `t.positioning`: 18px/600, lh 1.9, `flex:1; min-width:280px;`.
4. **Values**: H2 `t.aboutValuesT` 26px/700 `margin: 0 0 26px` centered; grid `repeat(4,1fr); gap:18px;` Loop `aboutVals` (4 × `{ t, d }`): white card radius 18px padding `26px 22px`; title 16px/700 mb 6px color `#1B3568`; desc 13.5px `#7684A0` lh 1.8.

i18n keys: `aboutKicker, aboutTitle, aboutLead, aboutMissionT, aboutMission, aboutVisionT, aboutVision, positioning, aboutValuesT` + `aboutVals` data list.

---

## 4. FOR CLIENTS (`isPubClients`)
Wrapper: `max-width:1180px; margin:0 auto; padding: 76px 24px 96px;`

1. **Header** (centered, `max-width:700px; margin:0 auto 52px;`): kicker `t.fcKicker` (13px/700 `#14969E` ls .05em mb 12px); H1 `t.fcTitle` (40px/700, mb 18px, `#14213A`, lh 1.4); lead `t.fcLead` (16.5px `#4A5A76` lh 1.9).
2. **Benefits grid**: `1fr 1fr; gap:20px; margin-bottom:48px;` Loop `fcBenefits` (4 × `{ t, d }`): white card border `#E4E9F1` radius 18px padding 28px, flex gap 16px align flex-start:
   - ✓ chip: 26×26px circle, bg `#E8F5F6`, color `#0E7A81`, 13px/700, centered, flex-shrink 0, `margin-top:2px`.
   - Title `{b.t}` 16.5px/700 mb 5px; desc `{b.d}` 14px `#7684A0` lh 1.8.
3. **Pipeline strip** — identical component to landing §2.2 (same `pipeSteps` loop, same styles: `#14213A` bg, radius 18, padding `22px 32px`, 30px teal-tinted number circles, `#3D5378` arrows), plus `margin-bottom: 48px;` → **extract as shared `<PipelineStrip/>` component**.
4. **CTA** (centered): `t.startCta` → `goSignupC` — bg `#1B3568`, white, 16px/700, padding `15px 34px`, radius 12px, shadow `0 8px 24px rgba(27,53,104,.3)`, hover bg `#24437F`.

i18n: `fcKicker, fcTitle, fcLead, startCta` + `fcBenefits` list + `pipeSteps`.

---

## 5. FOR PROVIDERS (`isPubProviders`)
Wrapper: `max-width:1180px; margin:0 auto; padding: 76px 24px 96px;`

1. **Header** (centered, max-width 700px, mb 52px): kicker `t.fpKicker` (13px/700 `#14969E`); H1 `t.fpTitle` (40px/700); lead `t.fpLead` (16.5px `#4A5A76` lh 1.9).
2. **Benefits grid**: `1fr 1fr; gap:20px; mb 48px;` Loop `fpBenefits` (4 × `{ t, d }`) — same card as For-Clients benefits **except ✓ chip colors**: bg `#F7F0E3`, color `#8A6D33` (gold instead of teal).
3. **3-step gradient cards**: grid `repeat(3,1fr); gap:18px; margin-bottom:48px;` Loop `fpSteps` (3 × `{ n, t, d }`): card `background: linear-gradient(160deg, #1B3568, #0F5E64); border-radius:18px; padding: 28px 24px; color:#fff;`
   - Number tile: 34×34px, radius 11px, `background: rgba(255,255,255,.14); color:#7FE3E9;` 15px/700, centered, mb 16px.
   - Title 16px/700 mb 6px; desc 13.5px `rgba(255,255,255,.75)` lh 1.8.
4. **CTA** (centered): `t.joinCta` → `goSignupP` — bg `#0E7A81`, white, 16px/700, padding `15px 34px`, radius 12px, shadow `0 8px 24px rgba(14,122,129,.3)`, hover bg `#14969E`.

i18n: `fpKicker, fpTitle, fpLead, joinCta` + `fpBenefits`, `fpSteps` lists.

---

## 6. CONTACT (`isPubContact`)
Wrapper: `max-width:1080px; margin:0 auto; padding: 76px 24px 96px;` (note narrower 1080px).

1. **Header** (centered, `max-width:640px; margin:0 auto 44px;`): H1 `t.contactTitle` 38px/700 mb 14px `#14213A`; lead `t.contactLead` 16px `#4A5A76` lh 1.9.
2. **Grid**: `grid-template-columns: 1.5fr 1fr; gap: 22px; align-items: start;`

**Left — form card** (white, border `#E4E9F1`, radius 20px, padding 32px):
- Shared field pattern: label div 13px/600 `#4A5A76` mb 6px; input `width:100%; border: 1.5px solid #E4E9F1; border-radius:10px; padding: 11px 14px; font-size:14px; outline:none; background:#FBFCFE;` focus: `border-color: #14969E;`
- Row 1 (grid `1fr 1fr; gap:16px; mb 16px`): `t.cfName` input; `t.cfEmail` input.
- `t.cfSubject` input (mb 16px).
- `t.cfMessage` textarea `rows=5`, same input styles + `resize: vertical` (mb 22px).
- Submit `t.cfSend` → `contactSend`: bg `#1B3568`, white, 14.5px/700, padding `13px 28px`, radius 11px, hover `#24437F`.

**Right — info cards** (flex-col gap 14px). Three cards, each: white, border `#E4E9F1`, radius 16px, padding 22px; label 12.5px `#93A1B8` mb 4px; value 15px/700:
1. `t.ciEmail` → value `hello@talaqi.sa` with `dir="ltr"` and color `#1B3568`.
2. `t.ciLocation` → `t.ciLocationV`.
3. `t.ciHours` → `t.ciHoursV`.

---

## 7. LOGIN (`isPubLogin`)
Wrapper: `min-height: calc(100vh - 220px); display:flex; align-items:center; justify-content:center; padding: 60px 24px;`

**Card**: `background:#fff; border:1px solid #E4E9F1; border-radius:22px; padding:40px; width:430px; max-width:100%; box-shadow: 0 20px 60px rgba(20,40,80,.08);`

1. **Header** (centered, mb 26px): logo 52×51px (mb 12px); `t.loginTitle` 22px/700; `t.loginSub` 14px `#7684A0`.
2. **Email field** (mb 14px): label `t.lfEmail` (13px/600 `#4A5A76` mb 6px); input `dir="ltr"` placeholder `you@company.sa`, styles: `width:100%; border:1.5px solid #E4E9F1; radius 10px; padding: 12px 14px; 14px; bg #FBFCFE;` focus border `#14969E`.
3. **Password field** (mb 8px): label `t.lfPassword`; `type="password" dir="ltr"` placeholder `••••••••`, same styles.
4. **Forgot link**: `text-align: end; margin-bottom: 18px;` — span `t.forgotPass` 12.5px `#14969E` 600 cursor pointer.
5. **Login button** → `demoAsClient` (demo prototype routes login to client dashboard): full width, bg `#1B3568`, white, 15px/700, padding 13px, radius 11px, mb 20px, hover `#24437F` — label `t.loginBtn`.
6. **Divider** (flex center gap 12px, mb 14px): 1px lines `background:#EEF1F6` flanking `t.loginDemo` (12px `#93A1B8` nowrap).
7. **Demo quick-access buttons** — grid `1fr 1fr 1fr; gap:8px; mb 20px;` Each: no border, 12.5px/600, padding `10px 6px`, radius 9px:
   - `t.demoClient` → `demoAsClient`: bg `#F0F3F8`, color `#1B3568`, hover bg `#E4E9F1`.
   - `t.demoProvider` → `demoAsProvider`: bg `#E8F5F6`, color `#0E7A81`, hover bg `#D5EEEF`.
   - `t.demoAdmin` → `demoAsAdmin`: bg `#F7F0E3`, color `#8A6D33`, hover bg `#F0E5CC`.
8. **Footer line** (centered, 13px `#7684A0`): `{t.noAccount} ` + span `t.createOne` (`#14969E`, 700, pointer) → `goSignupC`.

---

## 8. SIGN UP (`isPubSignup`)
Wrapper: same centering as login (`min-height: calc(100vh - 220px)`, flex center, padding `60px 24px`).

**Card**: white, border `#E4E9F1`, radius 22px, padding 40px, `width: 560px; max-width:100%;` shadow `0 20px 60px rgba(20,40,80,.08)`.

1. **Header** (centered, mb 24px): `t.signupTitle` 22px/700; `t.signupSub` 14px `#7684A0`.
2. **Role cards** — grid `1fr 1fr; gap:12px; margin-bottom:22px;` Two `<button>`s, `text-align:start; border-radius:14px; padding:16px; cursor:pointer; border: 2px solid <dyn>; background: <dyn>;`
   - **Client card** → `suSetClient`: `background:{suClientBg}; border-color:{suClientBd};` — title `t.suClientT` 15px/700 `#1B3568` mb 3px; desc `t.suClientD` 12.5px `#7684A0`.
   - **Provider card** → `suSetProvider`: `background:{suProviderBg}; border-color:{suProviderBd};` — title `t.suProviderT` 15px/700 **`#0E7A81`**; desc `t.suProviderD`.
   - Selection state (from support.js): the selected card gets a tinted bg + colored 2px border (client selected: teal-navy tint e.g. `#EEF3FB`/`#1B3568`; provider selected: `#E8F5F6`/`#0E7A81`); the unselected card gets `#fff` bg + `#E4E9F1` border. Implement as `role: 'client' | 'provider'` state, default **client** (`suIsClient` placeholder true).
3. **Form grid** — `grid-template-columns: 1fr 1fr; gap:14px; margin-bottom:14px;` All inputs use the standard input styles (`1.5px solid #E4E9F1`, radius 10, padding `11px 14px`, 14px, bg `#FBFCFE`, focus border `#14969E`); labels 13px/600 `#4A5A76` mb 6px. Fields in order:
   1. `t.sfName` — text input.
   2. `t.sfPhone` — `dir="ltr"`, placeholder `+966 5X XXX XXXX`.
   3. `t.sfEmail` — `dir="ltr"`.
   4. `t.sfPassword` — `type="password" dir="ltr"`.
   5. `{suOrgLabel}` — dynamic label (company/organization name for client vs. entity/provider name for provider), text input.
   6. **Conditional 6th cell**:
      - If `suIsProvider`: label `t.sfCat` + `<select>` with same input styles but padding `11px 10px` and `color:#2C3A54`, options = loop over `cats` list (`<option>{c.name}</option>`) — the same 16 categories as landing §2.7.
      - If `suIsClient` (default): label `t.sfCity` + text input.
4. **Submit button** → `suSubmit`: full width, `background: {suBtnBg}` (role-dependent: `#1B3568` for client, `#0E7A81` for provider), white, 15px/700, padding 13px, radius 11px, mb 12px, hover `opacity:.93` — label `t.signupBtn`.
5. **Terms note** `t.termsNote`: 11.5px, `#93A1B8`, centered, mb 14px.
6. **Footer line** (centered 13px `#7684A0`): `{t.haveAccount} ` + span `t.signInLink` (`#14969E`/700/pointer) → `goLogin`.

---

## 9. Shared Public FOOTER (all public screens)
Outer: `background: #14213A; color: #fff;`

**Top grid**: `max-width:1180px; margin:0 auto; padding: 52px 24px 36px; display:grid; grid-template-columns: 2fr 1fr 1fr; gap: 40px;`
1. **Brand column**: brand row (flex gap 10px, mb 12px) — logo in white tile (radius 10px, padding 5px, img 28×27px) + `t.brand` 18px/700; paragraph `t.positioning` 13.5px `#8A9AB8` `max-width:340px`.
2. **Links col 1** (flex-col gap 10px): heading `t.footerLinks1` 13px/700 `#8A9AB8` mb 4px; links (13.5px `#C4CFE2` pointer): `t.navHow`→`scrollHow`, `t.navCats`→`scrollCats`, `t.navPricing`→`scrollPricing`, `t.navClients`→`goPubClients`.
3. **Links col 2**: heading `t.footerLinks2`; links: `t.footerAbout`→`goPubAbout`, `t.navProviders`→`goPubProviders`, `t.footerContact`→`goPubContact`, `t.footerTerms` (no handler).

**Bottom bar**: `border-top: 1px solid rgba(255,255,255,.08);` inner `max-width:1180px; margin:0 auto; padding:18px 24px; display:flex; justify-content:space-between; flex-wrap:wrap; gap:10px; font-size:12.5px; color:#6B7C9E;` — `t.footerRights` and `t.footerMade`.

---

## 10. Full i18n key inventory (public screens)
`brand, tagline, navHow, navClients, navProviders, navAbout, navPricing, navContact, navCats, langBtn, login, startCta, joinCta, heroBadge, heroTitle1, heroTitle2, heroSub, heroSubEn, statBriefs, statProviders, statMatch, pipe1, pipe3, chatStarter1, bBudget, matchScore, oldJourney, oldSteps, newJourney, newSteps, problemTitle, solutionTitle, positioning, howTitle, howSub, valueTitle, forClients, forProviders, featuresTitle, featuresSub, catsTitle, catsSub, catProject, pricingTitle, pricingSub, popular, closingTitle, closingSub, aboutKicker, aboutTitle, aboutLead, aboutMissionT, aboutMission, aboutVisionT, aboutVision, aboutValuesT, fcKicker, fcTitle, fcLead, fpKicker, fpTitle, fpLead, contactTitle, contactLead, cfName, cfEmail, cfSubject, cfMessage, cfSend, ciEmail, ciLocation, ciLocationV, ciHours, ciHoursV, loginTitle, loginSub, lfEmail, lfPassword, forgotPass, loginBtn, loginDemo, demoClient, demoProvider, demoAdmin, noAccount, createOne, signupTitle, signupSub, suClientT, suClientD, suProviderT, suProviderD, sfName, sfPhone, sfEmail, sfPassword, sfCat, sfCity, signupBtn, termsNote, haveAccount, signInLink, footerLinks1, footerLinks2, footerAbout, footerContact, footerTerms, footerRights, footerMade`

Data lists (localized objects in support.js, port to typed constants): `pipeSteps[5] {n,label,arrow}`, `problems[4] {text}`, `howSteps[5] {n,t,d,tileBg,tileFg}`, `clientVals[4] {text}`, `providerVals[4] {text}`, `features[8] {t,d,dot}`, `cats[16] {name,count}`, `plans[4] {n,p,per,hot,bg,border,fg,check,btnBg,btnFg,btnBorder,featList[{text}],go,cta}`, `aboutVals[4] {t,d}`, `fcBenefits[4] {t,d}`, `fpBenefits[4] {t,d}`, `fpSteps[3] {n,t,d}`.
Dynamic strings: `dir, dirOpp, arrowChar, briefTitle, heroTimeline, heroMatchName, heroMatchRole, wClients/cClients, wProviders/cProviders, wAbout/cAbout, wContact/cContact, suClientBg/Bd, suProviderBg/Bd, suOrgLabel, suBtnBg, suIsClient, suIsProvider`.

## 11. Componentization & responsive guidance
- Shared components: `PublicNav`, `PublicFooter`, `PipelineStrip` (used on landing + For-Clients), `Field` (label+input with focus ring), `CheckRow` (✓ chip + text, teal/gold variants), `AuthCard` shell (430px login / 560px signup).
- Route mapping: `/` (home), `/about`, `/clients`, `/providers`, `/contact`, `/login`, `/signup` — all rendered within a public layout carrying nav + footer; `isPub*` flags become route matches; anchor scrolls target `#tq-how`, `#tq-features`, `#tq-cats`, `#tq-pricing` on `/`.
- Prototype has no media queries; grids use fixed column counts (`repeat(5/4/3/2, 1fr)`). Responsive hints: hero grid → 1 col < 1024px; 5-col how-it-works → 2–3 cols tablet / 1 mobile; 4-col features/cats/pricing/values → 2 cols tablet / 1 mobile; contact `1.5fr 1fr` and signup `1fr 1fr` → 1 col mobile; footer `2fr 1fr 1fr` → stacked; pipeline strip already `flex-wrap: wrap`. Nav links may collapse to a menu < 900px.
- All buttons `cursor: pointer`; transitions on hoverable cards `all .2s`; primary hover lifts use `translateY(-1px)` / `-3px`.
