# Client Screens — Implementation Spec (Next.js 15 + TypeScript + Tailwind)

Source of truth: `Talaqi Platform.dc.html` lines 616–1046 (markup), inline `data-dc-script` component (state/logic), and `talaqi-data.js` (data + `I18N`). This spec covers the 7 client-side screens rendered inside the app shell content area. Arabic (`ar`) is the default language, `dir="rtl"`; all inline styles use CSS **logical** properties (`inset-inline-start`, `border-inline`, `border-inline-start`, `margin-inline`, `text-align: start`), so LTR/RTL flipping is automatic.

## 0. Shared conventions

### 0.1 Palette (constants used across all screens)
| Token | Value | Usage |
|---|---|---|
| NAVY | `#1B3568` | primary brand, buttons, headings accents |
| NAVY hover | `#24437F` | hover bg of navy buttons |
| TEAL | `#14969E` | secondary accent, links, dots, focus borders |
| Teal dark text | `#0E7A81` | teal-tinted text/chips |
| Gold | `#C6A15B` | complexity bar, tertiary accent |
| Gold text | `#8A6D33` | warning/amber text |
| Ink | `#14213A` | darkest text (labels on stepper) |
| Body text | `#2C3A54` | paragraph text |
| Muted body | `#4A5A76` | secondary body text |
| Muted | `#7684A0` | subtitles, muted labels |
| Faint | `#93A1B8` | faintest labels/meta |
| Border | `#E4E9F1` | card borders |
| Divider | `#EEF1F6` | inner row dividers / hairlines |
| Row divider | `#F3F5F9` | table row borders |
| Hover row | `#FAFBFD` | row hover bg |
| Chip navy bg | `#EEF3FB` | navy chip bg |
| Chip teal bg | `#E8F5F6` | teal chip bg |
| Teal wash | `#F2F7F9` (border `#DCEBEE`) | info boxes, reason box |
| Green bg/fg | `#E9F6EF` / `#1F7A4D` | success chips |
| Amber bg/border/fg | `#FDF9F0` / `#EFE2C6` / `#8A6D33` | warning card |
| Pill gray bg | `#F0F3F8` | neutral chip / toggle track |
| Input bg | `#FBFCFE` | chat body bg + inputs |
| Outline border | `#D5DDE9` | secondary (ghost) buttons |
| Green dot | `#2FA36B` | "online" status dot |
| Inactive dot | `#C9D3E2` | activity-log dots |

### 0.2 Keyframes (global CSS)
```css
@keyframes tq-blink { 0%, 100% { opacity: .2; } 50% { opacity: 1; } }
@keyframes tq-rise  { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
@keyframes tq-spin  { /* standard 360° rotation, 1s linear infinite (generating overlay spinner) */ }
```

### 0.3 Template syntax mapping
- `{{ t.key }}` → i18n lookup into `I18N[lang]` (from `talaqi-data.js`). Default `lang = 'ar'`.
- `{{ handler }}` → callback from `renderVals()` in the component script.
- `<sc-if value="{{ cond }}">` → conditional render (`cond && <>...</>`).
- `<sc-for list="{{ arr }}" as="x">` → `arr.map(x => ...)`.
- `style-hover="..."` → styles applied on `:hover` (implement as Tailwind `hover:` utilities or CSS). `style-focus="..."` similarly for `:focus`.

### 0.4 Status map (used by Home, Projects, Detail)
```js
statusMap = {
  draft:      { l: t.stDraft,      bg: '#F0F3F8', fg: '#7684A0' },   // "مسودة"
  brief:      { l: t.stBrief,      bg: '#EEF3FB', fg: '#1B3568' },   // "ملخص مولّد"
  matched:    { l: t.stMatched,    bg: '#E8F5F6', fg: '#0E7A81' },   // "مرشحون جاهزون"
  selected:   { l: t.stSelected,   bg: '#F7F0E3', fg: '#8A6D33' },   // "تم اختيار مقدم"
  inprogress: { l: t.stInprogress, bg: '#FDF9F0', fg: '#8A6D33' },   // "قيد التنفيذ"
  completed:  { l: t.stCompleted,  bg: '#E9F6EF', fg: '#1F7A4D' },   // "مكتمل"
}
```

### 0.5 Shared derived data
- `projectRows` = `PROJECTS.map(p => ({ title, cat, budget, timeline, stLabel/stBg/stFg (from statusMap), date, open: navigate to cPage 'detail' + scrollTo top }))`. 5 rows (perfume store / café identity / Riyadh Season campaign / salon app / analytics dashboard).
- `arrowChar` = `←` in AR, `→` in EN (the templates hard-code `←` in a few places; treat as directional arrow).
- Toast: fixed, `bottom: 28px; inset-inline-start: 50%; transform: translateX(50% in AR / -50% in EN); z-index: 120; background: #14213A; color: #fff; font-size: 14px; font-weight: 600; padding: 13px 26px; border-radius: 12px; box-shadow: 0 14px 40px rgba(0,0,0,.3); animation: tq-rise .3s ease both;` auto-dismisses after **2600ms**.
- All page-changing handlers also call `window.scrollTo({ top: 0 })`.

### 0.6 Screen routing conditions
| Flag | Condition |
|---|---|
| `isClientHome` | app view + role client + `cPage==='home'` |
| `isClientChat` | `cPage==='chat'` |
| `isClientBrief` | `cPage==='brief'` |
| `isClientMatches` | `cPage==='matches'` |
| `isClientProjects` | `cPage==='projects'` |
| `isClientDetail` | `cPage==='detail'` |
| `isClientProfile` | `cPage==='profile'` |

---

## 1. Client dashboard home (`isClientHome`, label "Client dashboard")

Container: `max-width: 1000px; margin: 0 auto;`

### 1.1 Page header
- Row: `display:flex; align-items:flex-end; justify-content:space-between; gap:16px; margin-bottom:22px; flex-wrap:wrap;`
- `h1`: `{{ t.welcome }}` ("مرحبًا أحمد 👋") — `font-size:24px; font-weight:700; margin:0 0 4px;`
- `p`: `{{ t.welcomeSub }}` ("لنحوّل احتياجك القادم إلى مشروع واضح") — `color:#7684A0; margin:0; font-size:14.5px;`

### 1.2 CTA banner
- `background: linear-gradient(120deg, #1B3568, #14969E 140%); border-radius:18px; padding:26px 30px; color:#fff; display:flex; align-items:center; gap:20px; margin-bottom:22px; flex-wrap:wrap;`
- Text block: `flex:1; min-width:240px;`
  - Title `{{ t.newProjectCta }}` ("ابدأ مشروعًا جديدًا"): `font-size:19px; font-weight:700; margin-bottom:4px;`
  - Sub `{{ t.newProjectSub }}` ("صف احتياجك وسيتولى الذكاء الاصطناعي الباقي"): `font-size:13.5px; opacity:.8;`
- Button `onClick={{ goChat }}` (sets `cPage:'chat'`): text `{{ t.newProjectCta }} ✦` — `background:#fff; color:#1B3568; border:none; cursor:pointer; font-size:15px; font-weight:700; padding:13px 26px; border-radius:11px; box-shadow:0 6px 18px rgba(0,0,0,.15);` hover: `transform: translateY(-1px);`

### 1.3 Stats grid (4 cards)
- Grid: `grid-template-columns: repeat(4, 1fr); gap:16px; margin-bottom:26px;`
- Card: `background:#fff; border:1px solid #E4E9F1; border-radius:16px; padding:20px;`
  - Label: `font-size:13px; color:#7684A0; margin-bottom:6px;`
  - Value: `font-size:27px; font-weight:700; color:{{ s.color }};`
- Data (`clientStats`):
  1. `t.statActive` "مشاريع نشطة" → `3`, color `#1B3568`
  2. `t.statBriefsDone` "ملخصات مولّدة" → `'5'` if `briefReady` else `'4'`, color `#14969E`
  3. `t.statProposals` "عروض مستلمة" → `7`, color `#1B3568`
  4. `t.statSaved` "ساعات موفّرة" → `26+`, color `#8A6D33`

### 1.4 My projects card (compact table)
- Card: `background:#fff; border:1px solid #E4E9F1; border-radius:18px; overflow:hidden;`
- Header row: `padding:18px 24px; display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #EEF1F6;`
  - Title `{{ t.myProjects }}` ("مشاريعي"): `font-size:16px; font-weight:700;`
  - Link button `onClick={{ goProjects }}`: `{{ t.viewAll }} ←` ("عرض الكل ←") — `background:none; border:none; color:#14969E; font-size:13.5px; font-weight:600; cursor:pointer;`
- Rows (`projectRows`, all 5): `onClick={{ p.open }}` → detail page. `padding:15px 24px; display:grid; grid-template-columns: 2fr 1fr 1fr 1fr; gap:12px; align-items:center; border-bottom:1px solid #F3F5F9; cursor:pointer;` hover `background:#FAFBFD;`
  - Col 1: title `font-size:14.5px; font-weight:600;` + category `font-size:12.5px; color:#93A1B8;`
  - Col 2 budget / Col 3 timeline: `font-size:13.5px; color:#4A5A76;`
  - Col 4 status pill: `background:{{p.stBg}}; color:{{p.stFg}}; font-size:12px; font-weight:600; padding:4px 12px; border-radius:999px; white-space:nowrap;`
- Note: home table has **no** header row and **no** date column (unlike the Projects screen).

---

## 2. AI chat assistant (`isClientChat`, label "AI chat assistant")

Container: `max-width:780px; margin:0 auto; height: calc(100vh - 130px); display:flex; flex-direction:column;` (fills viewport minus shell chrome; body scrolls internally).

### 2.1 Chat header (top card)
- `background:#fff; border:1px solid #E4E9F1; border-radius:18px 18px 0 0; padding:16px 22px; display:flex; align-items:center; gap:14px;`
- Avatar: `width:42px; height:42px; border-radius:13px; background: linear-gradient(135deg, #1B3568, #14969E); color:#fff; font-weight:700; font-size:17px;` centered content, glyph `ت`.
- Title block (`flex:1`):
  - `{{ t.chatTitle }}` "مساعد تلاقي الذكي" — `font-size:15.5px; font-weight:700;`
  - Status line: `font-size:12.5px; color:#7684A0; display:flex; align-items:center; gap:6px;` containing green dot (`width:7px; height:7px; border-radius:50%; background:#2FA36B;`) then `{{ t.chatSub }} — {{ t.chatOnline }}` ("مستشار الشراء الخاص بك — متصل").
- **Scripted/Live segmented toggle**: wrapper `display:flex; background:#F0F3F8; border-radius:999px; padding:3px; gap:2px;`
  - Button 1 `onClick={{ setScripted }}` (`liveMode=false`): text `{{ t.chatScripted }}` "محادثة تجريبية". Both buttons: `border:none; cursor:pointer; font-size:12px; font-weight:600; padding:6px 14px; border-radius:999px;`
  - Button 2 `onClick={{ setLive }}` (`liveMode=true` + `ensureHello()` pushes `t.chatHello` AI message if history empty): text `⚡ {{ t.chatLive }}` "⚡ ذكاء حي".
  - Active/inactive styles:
    - `scriptedBg = !liveMode ? '#fff' : 'transparent'`; `scriptedFg = !liveMode ? '#1B3568' : '#7684A0'`
    - `liveBg = liveMode ? '#fff' : 'transparent'`; `liveFg = liveMode ? '#0E7A81' : '#7684A0'`

### 2.2 Chat body (scrollable)
- `flex:1; background:#FBFCFE; border-inline:1px solid #E4E9F1; padding:24px 22px; overflow-y:auto; overflow-x:hidden; display:flex; flex-direction:column; gap:16px;` with a ref (`chatBoxRef`); after each pushed message, auto-scroll to bottom after **60ms** (`el.scrollTop = el.scrollHeight`).

#### 2.2.1 Live-mode banner (`sc-if liveMode`)
- `align-self:center; background:#E8F5F6; color:#0E7A81; font-size:12px; font-weight:600; padding:5px 16px; border-radius:999px;` text `⚡ {{ t.liveNote }}` ("وضع الذكاء الحي: تحدث بحرية وسيرد المساعد مباشرة").

#### 2.2.2 Message bubbles (`sc-for messages`)
Wrapper per message: `display:flex; flex-direction:column; align-items:{{ m.align }}; animation: tq-rise .3s ease both;`
Bubble: `max-width:78%; background:{{m.bg}}; color:{{m.fg}}; border:{{m.border}}; border-radius:{{m.radius}}; padding:13px 18px; font-size:14.5px; line-height:1.8; box-shadow:0 2px 8px rgba(20,40,80,.05); white-space:pre-wrap;`

| Prop | AI (`who==='ai'`) | User |
|---|---|---|
| align | `flex-start` | `flex-end` |
| bg | `#fff` | `#1B3568` |
| fg | `#2C3A54` | `#fff` |
| border | `1px solid #E4E9F1` | `none` |
| radius | `4px 16px 16px 16px` (small corner at top-start) | `16px 4px 16px 16px` (small corner at top-end) |

Note on radius in RTL: values are physical (`top-left top-right bottom-right bottom-left`). In the RTL default the AI bubble's tight corner (4px top-left) is visually the trailing corner; preserve as-is (do not logical-flip) to match prototype.

#### 2.2.3 Typing indicator (`sc-if typing`)
- Row `display:flex;` (aligns start).
- Pill: `background:#fff; border:1px solid #E4E9F1; border-radius:16px; padding:14px 20px; display:flex; gap:5px;`
- Three dots, each `width:7px; height:7px; border-radius:50%; background:#14969E;` with `animation: tq-blink 1.2s infinite`, second delayed `.2s`, third `.4s`.

#### 2.2.4 Starter suggestions (`sc-if showStarters`)
- Shown when `!started && !liveMode && !typing` (i.e., pristine scripted chat).
- Column: `display:flex; flex-direction:column; gap:8px; margin-top:4px;`
- 3 buttons (`starters`), each `onClick={{ s.go }}` → `startScript(text)`:
  - `t.chatStarter1` "أحتاج متجرًا إلكترونيًا لبيع العطور"
  - `t.chatStarter2` "أحتاج هوية بصرية لمشروعي الناشئ"
  - `t.chatStarter3` "أحتاج حملة تسويقية لمنتج جديد"
- Style: `align-self:flex-start; background:#fff; border:1.5px solid #C6E7E9; color:#0E7A81; cursor:pointer; font-size:13.5px; font-weight:600; padding:10px 18px; border-radius:999px;` hover `background:#E8F5F6; border-color:#14969E;`

#### 2.2.5 Quick-reply chips (`sc-if showChips`)
- `showChips` = current script question exists (`started && !chatDone && !typing && 0 <= step < CHAT_SCRIPT.length`) **and** `!liveMode`.
- Wrapper: `display:flex; flex-wrap:wrap; gap:8px; margin-top:4px;` (wraps horizontally, unlike starters which stack).
- Chip buttons: identical style to starters minus `align-self` (`background:#fff; border:1.5px solid #C6E7E9; color:#0E7A81; font-size:13.5px; font-weight:600; padding:10px 18px; border-radius:999px;` hover `background:#E8F5F6; border-color:#14969E;`).
- Content from `CHAT_SCRIPT[step].chips` (localized `ar`/`en`); click → `answerScript(chipText)`.

#### 2.2.6 Generate-brief button (`sc-if chatDone`)
- `chatDone` render flag = `state.chatDone && !briefReady` (hidden once a brief was generated).
- Wrapper: `align-self:center; margin-top:8px;`
- Button `onClick={{ generate }}`: text `✦ {{ t.generateBrief }}` ("✦ توليد الملخص التنفيذي") — `background: linear-gradient(120deg, #1B3568, #14969E); color:#fff; border:none; cursor:pointer; font-size:15px; font-weight:700; padding:14px 32px; border-radius:12px; box-shadow:0 10px 26px rgba(20,150,158,.3);` hover `transform: translateY(-1px);`

### 2.3 Composer (bottom bar)
- `background:#fff; border:1px solid #E4E9F1; border-top:none; border-radius:0 0 18px 18px; padding:14px 16px; display:flex; gap:10px;`
- Input: `value={{draft}} onChange={{onDraft}} onKeyDown={{onDraftKey}} placeholder={{ t.chatPlaceholder }}` ("صف احتياجك هنا…") — `flex:1; border:1.5px solid #E4E9F1; border-radius:11px; padding:12px 16px; font-size:14.5px; outline:none; background:#FBFCFE;` focus `border-color:#14969E;` Enter key sends + clears draft.
- Send button `onClick={{ sendDraft }}`: `{{ t.chatSend }}` ("إرسال") — `background:#1B3568; color:#fff; border:none; cursor:pointer; font-size:14px; font-weight:700; padding:12px 24px; border-radius:11px;` hover `background:#24437F;`

### 2.4 Chat state machine (exact behavior)
State: `messages:[], step:-1, typing:false, chatDone:false, started:false, draft:'', liveMode:false, liveHistory:[]`.
- `send(text)`: trim; ignore if empty or `typing` or `generating`. If `liveMode` → `sendLive`; else if `!started` → `startScript`; else if `!chatDone` → `answerScript`.
- `startScript(userText)`: push user bubble; `started=true, typing=true`; after **1100ms** → `typing=false, step=0`, push AI bubble `CHAT_SCRIPT[0].qAr|qEn`.
- `answerScript(text)`: push user bubble; `typing=true`; after **1000ms**: if next question exists → `step=next`, push AI question; else → `step=next, chatDone=true`, push AI `CHAT_DONE.ar|en` ("اكتملت الصورة لدي… جاهز لتوليد الملخص التنفيذي.").
- `CHAT_SCRIPT` has **5 questions** (products/count → brand identity → payments & shipping → budget → launch date), each with 2–3 localized chips (see `talaqi-data.js`).
- `sendLive(text)`: push user bubble; append to `liveHistory`; `typing=true`; call `window.claude.complete({ system, messages: hist, max_tokens: 400 })` with an AR/EN system prompt (procurement consultant, one question per message, max 5); on reply `typing=false`, append assistant to history, set `chatDone = liveHistory.length >= 3`, push AI bubble. On error: `typing=false` + fallback AI bubble ("تعذر الاتصال بالذكاء الحي حاليًا — يمكنك متابعة المحادثة التجريبية." / EN equivalent).
- `ensureHello()` (on switching to live): if `messages.length===0` push AI `t.chatHello` ("أهلًا بك في تلاقي 👋 …").

### 2.5 Generating overlay (triggered by `generate`)
- `generateBrief()`: `generating=true, genStep=0`; a timer ticks every **850ms** incrementing `genStep` 1→4; after the 5th tick sets `generating=false, briefReady=true, cPage='brief'` + scroll top.
- Overlay (global, `sc-if generating`): `position:fixed; inset:0; z-index:100; background: rgba(15,25,45,.55); backdrop-filter: blur(6px);` centered.
- Modal: `background:#fff; border-radius:22px; padding:40px 48px; width:440px; max-width:90vw; box-shadow:0 30px 80px rgba(0,0,0,.3);` `dir={{dir}}`.
- Header: spinner `width:40px; height:40px; border:3px solid #E4E9F1; border-top-color:#14969E; border-radius:50%; animation: tq-spin 1s linear infinite;` + `{{ t.generating }}` ("جارٍ توليد الملخص التنفيذي…") `font-size:17px; font-weight:700; color:#14213A;`
- 4 steps (`genSteps` from `t.genStep1..4`): row `display:flex; gap:12px; align-items:center; opacity:{{g.opacity}};` badge `width:22px; height:22px; border-radius:50%; background:{{g.bg}}; color:{{g.fg}}; font-size:12px; font-weight:700;` label `font-size:14px; color:#2C3A54; font-weight:500;`
  - done (`genStep > i`): mark `✓`, bg `#E9F6EF`, fg `#1F7A4D`, opacity 1
  - active (`genStep === i`): mark `i+1`, bg `#E8F5F6`, fg `#0E7A81`, opacity 1
  - pending: mark `i+1`, bg `#F0F3F8`, fg `#93A1B8`, opacity **0.45**
- i18n: `genStep1` "تحليل المتطلبات المستخرجة", `genStep2` "بناء نطاق العمل والمخرجات", `genStep3` "تقدير الميزانية والمدة الزمنية", `genStep4` "تحديد معايير التقييم والمراحل".

---

## 3. Project brief (`isClientBrief`, label "Project brief")

Container: `max-width:900px; margin:0 auto;`
Data: `BRIEF` object (perfume store). Edit state: `editing:boolean`, `edits:{title?,summary?,budget?}` — view values prefer `edits.x` when non-null (`briefTitleView`, `briefSummaryView`, `briefBudgetView`).

### 3.1 Header row
- `display:flex; align-items:flex-start; justify-content:space-between; gap:16px; margin-bottom:20px; flex-wrap:wrap;`
- Kicker: `✦ {{ t.briefKicker }}` ("الملخص التنفيذي للمشروع") — `font-size:12.5px; font-weight:700; color:#14969E; letter-spacing:.04em; margin-bottom:6px;`
- Title — **conditional**:
  - `notEditing`: `h1` `{{ briefTitleView }}` — `font-size:26px; font-weight:700; margin:0;`
  - `editing`: `<input value={{briefTitleView}} onChange={{onEditTitle}}>` — `font-size:22px; font-weight:700; border:1.5px solid #14969E; border-radius:10px; padding:8px 14px; width:480px; max-width:100%; outline:none;`
- Ready pill: `● {{ t.briefReady }}` ("جاهز للاعتماد") — `display:inline-flex; align-items:center; gap:6px; background:#E9F6EF; color:#1F7A4D; font-size:12.5px; font-weight:600; padding:4px 14px; border-radius:999px; margin-top:10px;`
- Actions (`display:flex; gap:10px;`):
  - Edit toggle `onClick={{ toggleEdit }}`: label `editBtnLabel` = `t.briefSaveEdit` ("حفظ التعديلات") when editing, else `'✎ ' + t.briefEdit` ("✎ تعديل"). Style: `background:#fff; color:#1B3568; border:1.5px solid #D5DDE9; cursor:pointer; font-size:13.5px; font-weight:600; padding:11px 20px; border-radius:10px;` hover `border-color:#1B3568;`
  - Approve `onClick={{ approveBrief }}`: `{{ t.briefApprove }} ←` ("اعتماد الملخص وعرض المرشحين ←") — `background:#1B3568; color:#fff; border:none; font-size:13.5px; font-weight:700; padding:11px 22px; border-radius:10px; box-shadow:0 6px 16px rgba(27,53,104,.25);` hover `background:#24437F;` Handler: `editing=false, cPage='matches', briefReady=true`, scroll top, toast `t.briefApprovedToast` ("تم اعتماد الملخص التنفيذي ✓").

### 3.2 Two-column layout
`display:grid; grid-template-columns: 1.6fr 1fr; gap:18px; align-items:start;` — left main column, right rail. Both columns are `display:flex; flex-direction:column; gap:18px;`

### 3.3 Left column — Card 1: Summary & objective
- Card: `background:#fff; border:1px solid #E4E9F1; border-radius:18px; padding:26px;`
- Section label style (used twice): `font-size:12.5px; font-weight:700; color:#93A1B8; letter-spacing:.05em; margin-bottom:8px;` — `{{ t.bSummary }}` ("الملخص"), `{{ t.bObjective }}` ("هدف العميل").
- Summary — **conditional**:
  - view: `p` `{{ briefSummaryView }}` — `margin:0 0 18px; font-size:15px; line-height:1.9; color:#2C3A54;`
  - edit: `<textarea rows=4 value onChange={{onEditSummary}}>` — `width:100%; border:1.5px solid #14969E; border-radius:10px; padding:10px 14px; font-size:14.5px; line-height:1.8; outline:none; margin-bottom:18px; resize:vertical;`
- Objective `{{ briefObjective }}` (NOT editable): `margin:0; font-size:14.5px; line-height:1.9; color:#4A5A76;`

### 3.4 Left column — Card 2: Scope + deliverables
- Same card shell (`padding:26px`).
- Title `{{ t.bScope }}` ("نطاق العمل"): `font-size:15px; font-weight:700; margin-bottom:16px;`
- Scope list (`briefScope`, 6 numbered items): column `gap:11px;` each row `display:flex; gap:11px; align-items:flex-start;`
  - Number badge: `width:20px; height:20px; border-radius:6px; background:#EEF3FB; color:#1B3568; font-size:11.5px; font-weight:700;` centered, `flex-shrink:0; margin-top:3px;` value `{{ s.n }}` (1-based).
  - Text: `font-size:14.5px; color:#2C3A54;`
- Divider: `height:1px; background:#EEF1F6; margin:20px 0;`
- Title `{{ t.bDeliverables }}` ("المخرجات المطلوبة"): `font-size:15px; font-weight:700; margin-bottom:14px;`
- Deliverable chips (`briefDeliverables`, 4): wrap `gap:8px;` chip `background:#F2F7F9; border:1px solid #DCEBEE; color:#0E7A81; font-size:13px; font-weight:600; padding:6px 14px; border-radius:999px;`

### 3.5 Left column — Card 3: Milestones timeline
- Card shell (`padding:26px`); title `{{ t.bMilestones }}` ("المراحل المقترحة"): `font-size:15px; font-weight:700; margin-bottom:16px;`
- Vertical timeline (`briefMilestones`, 4 items = weeks 1 / 2–3 / 4 / 5): each row `display:flex; gap:16px;`
  - Rail column: `display:flex; flex-direction:column; align-items:center;` — dot `width:11px; height:11px; border-radius:50%; background:#14969E; flex-shrink:0; margin-top:5px;` and, if `m.line` (`i < length-1`), connector `width:2px; flex:1; background:#DCEBEE;`
  - Content (`padding-bottom:18px;`): `{{ m.t }}` `font-size:13px; font-weight:700; color:#0E7A81;` + `{{ m.d }}` `font-size:14px; color:#4A5A76;`

### 3.6 Right rail — Card 1: Dark gradient budget/timeline/complexity card
- `background: linear-gradient(150deg, #1B3568, #0F5E64); border-radius:18px; padding:24px; color:#fff;`
- Label style (×3): `font-size:12.5px; opacity:.7; margin-bottom:4px;` (complexity label uses `margin-bottom:8px;`).
- Budget `{{ t.bBudget }}` ("الميزانية المقترحة") — **conditional**:
  - view: `{{ briefBudgetView }}` ("4,000 – 8,000") `font-size:25px; font-weight:700;` + unit span `{{ briefBudgetUnit }}` ("ريال سعودي") `font-size:13px; font-weight:500; opacity:.7;`
  - edit: `<input value onChange={{onEditBudget}}>` — `font-size:18px; font-weight:700; border:none; border-radius:8px; padding:8px 12px; width:100%; outline:none;` (white input on dark card).
- Divider (×2): `height:1px; background: rgba(255,255,255,.15); margin:16px 0;`
- Timeline `{{ t.bTimeline }}` ("مدة التنفيذ المتوقعة") → `{{ briefTimeline }}` ("3 – 5 أسابيع") `font-size:20px; font-weight:700;` (not editable).
- **Complexity bar**: label `{{ t.bComplexity }}: {{ briefComplexity }}` ("تعقيد المشروع: متوسطة"). Track: `height:7px; background: rgba(255,255,255,.18); border-radius:999px; overflow:hidden;` Fill: `height:100%; width:{{ briefComplexityPct }}; background:#C6A15B; border-radius:999px;` — `briefComplexityPct = BRIEF.complexityPct + '%'` = **55%**.

### 3.7 Right rail — Card 2: Skills
- White card `padding:22px;` title `{{ t.bSkills }}` ("المهارات المطلوبة") `font-size:14px; font-weight:700; margin-bottom:12px;`
- Chips (`briefSkills`, 5: E-commerce / UI-UX / Payment Integration / Shopify–WooCommerce / Shipping APIs): wrap `gap:7px;` chip `background:#EEF3FB; color:#1B3568; font-size:12.5px; font-weight:600; padding:5px 13px; border-radius:999px;`

### 3.8 Right rail — Card 3: Provider type + criteria
- White card `padding:22px;`
- `{{ t.bProviderType }}` ("نوع مقدم الخدمة الموصى به") `font-size:14px; font-weight:700; margin-bottom:8px;` → `{{ briefProviderType }}` `font-size:14px; color:#4A5A76; margin-bottom:16px;`
- `{{ t.bCriteria }}` ("معايير التقييم") `font-size:14px; font-weight:700; margin-bottom:10px;`
- Criteria rows (`briefCriteria`, 4): `display:flex; gap:9px; align-items:flex-start; font-size:13.5px; color:#4A5A76;` prefixed by check `✓` span `color:#14969E; font-weight:700;`

### 3.9 Right rail — Card 4: Open questions (amber)
- `background:#FDF9F0; border:1px solid #EFE2C6; border-radius:18px; padding:22px;`
- Title `{{ t.bMissing }}` ("أسئلة لا تزال مفتوحة") `font-size:14px; font-weight:700; color:#8A6D33; margin-bottom:10px;`
- Items (`briefMissing`, 2): `font-size:13.5px; color:#6E5A31;` each prefixed `؟ ` (Arabic question mark + space).

### 3.10 Edit mode summary (exactly which fields become inputs)
| Field | Editable? | Control |
|---|---|---|
| Title | YES | text input (header) |
| Summary | YES | 4-row textarea |
| Budget | YES | text input inside gradient card |
| Objective, scope, deliverables, milestones, skills, provider type, criteria, timeline, complexity, missing questions | NO | static |
Edits persist in `state.edits` even after toggling back (view uses `edits.x ?? BRIEF default`). `toggleEdit` merely flips `editing`; "save" is implicit. Approving forces `editing=false`.

---

## 4. Recommended providers / Matches (`isClientMatches`, label "Recommended providers")

Container: `max-width:1000px; margin:0 auto;`

### 4.1 Header
- Kicker: `✦ {{ briefTitleView }}` — `font-size:12.5px; font-weight:700; color:#14969E; letter-spacing:.04em; margin-bottom:6px;` (wrapper `margin-bottom:6px;`)
- `h1` `{{ t.matchesTitle }}` ("مقدمو الخدمة المرشحون"): `font-size:25px; font-weight:700; margin:0 0 4px;`
- Sub `{{ t.matchesSub }}` ("رتّبنا الأنسب لمشروعك وفق 7 معايير توافق"): `color:#7684A0; margin:0; font-size:14.5px;`
- Basis note: `ⓘ {{ t.matchBasis }}` — `background:#F2F7F9; border:1px solid #DCEBEE; border-radius:12px; padding:10px 18px; font-size:12.5px; color:#0E7A81; margin:16px 0 22px; display:inline-block;`

### 4.2 Match cards (`matchCards`, 6 — column `gap:16px;`)
Data: `MATCHES` (scores 94/91/88/84/79/76) joined with `PROVIDERS` by `pid` (providers 1–6).
Card: `background:#fff; border:1px solid #E4E9F1; border-radius:18px; padding:22px 24px; display:grid; grid-template-columns: auto 1fr auto; gap:20px; align-items:center;` hover `box-shadow:0 10px 28px rgba(20,40,80,.08); border-color:#C6E7E9;`

**Column A — score block** (`display:flex; flex-direction:column; align-items:center; gap:8px;`):
- Avatar: `width:58px; height:58px; border-radius:16px; background:{{mc.color}} (provider color: #1B3568/#14969E/#C6A15B); color:#fff; font-size:23px; font-weight:700;` centered initial `{{ mc.init }}`.
- Score: `{{ mc.score }}%` — `font-size:20px; font-weight:700; color:{{ mc.scoreColor }};` where `scoreColor = score>=85 ? '#0E7A81' : score>=78 ? '#8A6D33' : '#7684A0'`.
- Caption `{{ t.matchScore }}` ("نسبة التوافق"): `font-size:10.5px; color:#93A1B8;`

**Column B — info** (`min-width:0;`):
- Name row (`display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:3px;`):
  - Name `font-size:16.5px; font-weight:700;`
  - Type chip `{{ mc.type }}` ("مستقل"/"وكالة"/"شركة"): `background:#F0F3F8; color:#4A5A76; font-size:11.5px; font-weight:600; padding:2px 10px; border-radius:999px;`
  - `sc-if mc.verified` → chip `{{ t.verifiedBadge }}` ("موثّق ✓"): `background:#E9F6EF; color:#1F7A4D;` same metrics.
- Meta line: `{{ mc.role }} · {{ mc.city }} · ★ {{ mc.rating }} · {{ mc.years }} {{ t.yearsExp }} · {{ mc.price }} {{ t.perProject }}` — `font-size:13.5px; color:#7684A0; margin-bottom:10px;` (`price` = `min.toLocaleString()+'–'+max.toLocaleString()`, `t.yearsExp`="سنوات خبرة", `t.perProject`="ريال").
- Skill chips (`mc.skillList`): wrap `gap:6px; margin-bottom:12px;` chip `background:#EEF3FB; color:#1B3568; font-size:12px; font-weight:600; padding:3px 11px; border-radius:999px;`
- **Reason box**: `background:#F2F7F9; border-inline-start:3px solid #14969E; border-radius:8px; padding:9px 14px; font-size:13px; color:#2C5B60;` containing bold lead `{{ t.whyMatch }}` ("لماذا هذا الترشيح؟") `font-weight:700;` then space + `{{ mc.reason }}`.

**Column C — actions** (`display:flex; flex-direction:column; gap:9px; min-width:140px;`):
- **Request-proposal states** (per card, keyed by `state.proposals[pid]`):
  - `sc-if mc.notRequested` → button `onClick={{ mc.request }}`: `{{ t.requestProposal }}` ("طلب عرض") — `background:#1B3568; color:#fff; border:none; font-size:13.5px; font-weight:700; padding:11px 18px; border-radius:10px;` hover `background:#24437F;` Handler sets `proposals[pid]=true` and toasts `t.proposalSent` ("تم إرسال طلب العرض ✓").
  - `sc-if mc.requested` → static badge `{{ t.proposalRequested }} ✓` ("بانتظار العرض ✓") — `background:#E9F6EF; color:#1F7A4D; font-size:13px; font-weight:700; padding:11px 18px; border-radius:10px; text-align:center;`
- View profile button (no handler in prototype): `{{ t.viewProfile }}` ("عرض الملف") — `background:#fff; color:#1B3568; border:1.5px solid #D5DDE9; font-size:13.5px; font-weight:600; padding:10px 18px; border-radius:10px;` hover `border-color:#1B3568;`

---

## 5. My projects (`isClientProjects`, label "My projects")

Container: `max-width:1000px; margin:0 auto;`
- `h1` `{{ t.myProjects }}`: `font-size:24px; font-weight:700; margin:0 0 20px;`
- Table card: `background:#fff; border:1px solid #E4E9F1; border-radius:18px; overflow:hidden;`
- Header row: `padding:13px 24px; display:grid; grid-template-columns: 2fr 1fr 1fr 1fr 1fr; gap:12px; background:#FAFBFD; border-bottom:1px solid #EEF1F6; font-size:12.5px; font-weight:700; color:#7684A0;` — columns `t.thProject` "المشروع" / `t.thBudget` "الميزانية (ريال)" / `t.thTimeline` "المدة" / `t.thStatus` "الحالة" / `t.thDate` "التاريخ".
- Rows (`projectRows`, 5), `onClick={{ p.open }}` → detail: `padding:16px 24px; display:grid; grid-template-columns: 2fr 1fr 1fr 1fr 1fr; gap:12px; align-items:center; border-bottom:1px solid #F3F5F9; cursor:pointer;` hover `background:#FAFBFD;`
  - Cell 1: title (`14.5px/600`) + category (`12.5px; color:#93A1B8;`)
  - Budget & timeline: `font-size:13.5px; color:#4A5A76;`
  - Status pill: `background:{{p.stBg}}; color:{{p.stFg}}; font-size:12px; font-weight:600; padding:4px 12px; border-radius:999px; white-space:nowrap;`
  - Date: `font-size:13px; color:#93A1B8;` (e.g. `2026/06/28`)

---

## 6. Project details (`isClientDetail`, label "Project details")

Container: `max-width:1000px; margin:0 auto;` Data is hard-wired to `PROJECTS[0]` (perfume store) with status forced to `matched`.

### 6.1 Back link + header
- Back button `onClick={{ goProjects }}`: `{{ t.backToProjects }}` ("→ عودة لمشاريعي") — `background:none; border:none; cursor:pointer; color:#7684A0; font-size:13.5px; font-weight:600; padding:0; margin-bottom:14px;` hover `color:#1B3568;`
- Header row: `display:flex; align-items:flex-start; justify-content:space-between; gap:16px; margin-bottom:20px; flex-wrap:wrap;`
  - `h1` `{{ briefTitleView }}`: `font-size:25px; font-weight:700; margin:0 0 6px;`
  - Meta: `{{ detailCat }} · {{ detailDate }}` ("تجارة إلكترونية · 2026/06/28") — `font-size:13.5px; color:#7684A0;`
  - Status pill (statusMap.matched): `{{ detailStLabel }}` "مرشحون جاهزون" — `background:#E8F5F6; color:#0E7A81; font-size:13px; font-weight:700; padding:7px 18px; border-radius:999px;`

### 6.2 Stepper card — "مسار المشروع" (5 stops)
- Card: `background:#fff; border:1px solid #E4E9F1; border-radius:18px; padding:26px 30px; margin-bottom:18px;`
- Label `{{ t.pdStatusT }}`: `font-size:13px; font-weight:700; color:#93A1B8; letter-spacing:.05em; margin-bottom:20px;`
- Track: `display:flex; align-items:flex-start;` over `pdStepItems` (5 items from `t.pdSteps` = ["مسودة","ملخص مولّد","مرشحون جاهزون","طلب عروض","اختيار مقدم"]).
- Current step logic: `curStep = requestedProviders.length > 0 ? 3 : 2` (i.e., requesting any proposal advances the stepper from "مرشحون جاهزون" active to "طلب عروض" active). `done = i < curStep; active = i === curStep`.
- Per item wrapper: `display:flex; align-items:flex-start; flex:{{ st.flex }};` where `flex = i<4 ? '1' : '0 0 auto'`.
  - Node column: `display:flex; flex-direction:column; align-items:center; gap:8px; min-width:90px;`
    - Circle: `width:30px; height:30px; border-radius:50%; background:{{st.bg}}; color:{{st.fg}}; border:{{st.border}}; font-size:13px; font-weight:700;` centered. Content `{{ st.mark }}` = `✓` if done else `i+1`.
      - done: bg `#14969E`, fg `#fff`, border `none`
      - active: bg `#1B3568`, fg `#fff`, border `none`
      - pending: bg `#fff`, fg `#93A1B8`, border `2px solid #E4E9F1`
    - Label: `font-size:12px; font-weight:{{ active?700:500 }}; color:{{ done||active ? '#14213A' : '#93A1B8' }}; text-align:center; line-height:1.4;`
  - Connector (`sc-if st.line`, for i<4): `flex:1; height:3px; border-radius:999px; background:{{ i<curStep ? '#14969E' : '#EEF1F6' }}; margin-top:14px;`

### 6.3 Body grid
`display:grid; grid-template-columns: 1.5fr 1fr; gap:18px; align-items:start;` (both columns `flex column gap:18px`).

**Left — Brief snapshot card** (`padding:24px`):
- Header row (`margin-bottom:14px`): title `{{ t.pdBriefT }}` ("لمحة من الملخص التنفيذي") `font-size:15px; font-weight:700;` + link button `onClick={{ goBrief }}`: `{{ t.pdViewBrief }}` ("عرض الملخص الكامل ←") — `background:none; border:none; color:#14969E; font-size:13px; font-weight:700; cursor:pointer;`
- Objective paragraph `{{ briefObjective }}`: `font-size:14.5px; color:#4A5A76; line-height:1.9; margin:0 0 16px;`
- 3 fact chips (wrap `gap:8px`, each `font-size:12.5px; font-weight:600; padding:6px 14px; border-radius:999px;`):
  1. `{{ t.bBudget }}: {{ briefBudgetView }} {{ briefBudgetUnit }}` — `background:#EEF3FB; color:#1B3568;`
  2. `{{ t.bTimeline }}: {{ briefTimeline }}` — `background:#E8F5F6; color:#0E7A81;`
  3. `{{ t.bComplexity }}: {{ briefComplexity }}` — `background:#F7F0E3; color:#8A6D33;`

**Left — Milestones card**: identical structure/styles to brief §3.5 (title `t.bMilestones`, teal 11px dots, `#DCEBEE` 2px connectors, `padding:24px`).

**Right — Providers card** (`padding:22px`):
- Title `{{ t.pdProvidersT }}` ("مقدمو الخدمة"): `font-size:14px; font-weight:700; margin-bottom:14px;`
- `sc-if hasRequested` (any `proposals[pid]` true): column `gap:11px;` of provider mini-rows (`requestedProviders` = requested matches):
  - Row: `display:flex; gap:11px; align-items:center; border:1px solid #EEF1F6; border-radius:12px; padding:11px 14px;`
  - Avatar: `width:36px; height:36px; border-radius:11px; background:{{rp.color}}; color:#fff; font-size:15px; font-weight:700;` centered `{{ rp.init }}`, `flex-shrink:0`.
  - Name (`flex:1; min-width:0`): `font-size:13.5px; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;` + sub `{{ rp.score }}% {{ t.matchScore }}` `font-size:12px; color:#93A1B8;`
  - Badge `{{ t.proposalRequested }}` ("بانتظار العرض"): `background:#E9F6EF; color:#1F7A4D; font-size:11px; font-weight:700; padding:3px 10px; border-radius:999px; white-space:nowrap;`
- `sc-if noRequested` (empty state):
  - Text `{{ t.pdNoProviders }}` ("لم تطلب عروضًا بعد — راجع المرشحين"): `font-size:13.5px; color:#7684A0; margin-bottom:12px;`
  - Button `onClick={{ goMatches }}`: `{{ t.pdGoMatches }}` ("عرض المرشحين ←") — `background:#EEF3FB; color:#1B3568; border:none; font-size:13px; font-weight:700; padding:10px 18px; border-radius:10px;` hover `background:#E1E9F6;`

**Right — Activity log card** (`padding:22px`):
- Title `{{ t.pdActivityT }}` ("سجل النشاط"): `font-size:14px; font-weight:700; margin-bottom:16px;`
- Timeline (`pdActivityItems` from `t.pdActivity`, 4 entries, `line = i < len-1`): each row `display:flex; gap:13px;`
  - Rail: dot `width:9px; height:9px; border-radius:50%; background:#C9D3E2; flex-shrink:0; margin-top:6px;` + connector `width:2px; flex:1; background:#EEF1F6;` (if `a.line`).
  - Content (`padding-bottom:16px;`): time `{{ a.t }}` `font-size:11.5px; color:#93A1B8;` + text `{{ a.d }}` `font-size:13.5px; color:#2C3A54;`
- AR entries (newest first): "اليوم 10:24 ص — تم ترشيح 6 مقدمي خدمة للمشروع" / "اليوم 10:22 ص — اعتمد العميل الملخص التنفيذي" / "اليوم 10:15 ص — ولّد الذكاء الاصطناعي الملخص التنفيذي (13 بندًا)" / "اليوم 10:08 ص — بدأت محادثة توصيف الاحتياج".

---

## 7. Client profile (`isClientProfile`, label "Client profile")

Container: `max-width:860px; margin:0 auto;`

### 7.1 Header
- Wrapper `margin-bottom:22px;` — `h1` `{{ t.cpTitle }}` ("الملف الشخصي") `font-size:24px; font-weight:700; margin:0 0 4px;` + sub `{{ t.cpSub }}` ("بيانات جهتك تساعد الذكاء الاصطناعي على توصيف أدق") `color:#7684A0; font-size:14.5px; margin:0;`

### 7.2 Identity card
- `background:#fff; border:1px solid #E4E9F1; border-radius:18px; padding:26px; margin-bottom:18px; display:flex; gap:20px; align-items:center; flex-wrap:wrap;`
- Avatar: `width:72px; height:72px; border-radius:20px; background:#1B3568; color:#fff; font-size:30px; font-weight:700;` centered glyph `أ`.
- Text (`flex:1; min-width:220px;`): `{{ t.clientPerson }}` ("أحمد المطيري") `font-size:19px; font-weight:700;` + `{{ t.clientName }} · {{ t.memberSince }} {{ t.memberSinceV }}` ("شركة عود الخليج · عضو منذ مارس 2026") `font-size:14px; color:#7684A0;`
- Edit button `onClick={{ demoToast }}` (toast `t.demoOnly` "غير متاح في النسخة التجريبية"): `✎ {{ t.cpEdit }}` ("✎ تعديل البيانات") — `background:#fff; color:#1B3568; border:1.5px solid #D5DDE9; font-size:13.5px; font-weight:600; padding:11px 20px; border-radius:10px;` hover `border-color:#1B3568;`

### 7.3 Facts grid (`cpFacts`, 6 cards)
- Grid: `grid-template-columns: repeat(3, 1fr); gap:14px;`
- Card: `background:#fff; border:1px solid #E4E9F1; border-radius:14px; padding:16px 18px;`
  - Label: `font-size:12px; color:#93A1B8; margin-bottom:3px;`
  - Value: `dir={{ f.dir }}` + `font-size:14.5px; font-weight:700; color:#2C3A54; text-align:start;`
- Data (label → value → dir):
  1. `t.cpOrgType` "نوع الجهة" → `t.cpOrgTypeV` "شركة صغيرة" → page dir
  2. `t.cpSector` "القطاع" → `t.cpSectorV` "تجزئة — عطور ومستحضرات" → page dir
  3. `t.cpLocation` "الموقع" → `t.cpLocationV` "الرياض" → page dir
  4. `t.lfEmail` "البريد الإلكتروني" → `t.cpEmailV` `ahmed@oudalkhaleej.sa` → **`ltr`**
  5. `t.sfPhone` "رقم الجوال" → `t.cpPhoneV` `+966 55 123 4567` → **`ltr`**
  6. `t.pfLangs` "اللغات" → `AR / EN` → **`ltr`**
- Note: LTR values still use `text-align:start` (with dir=ltr that means left-aligned inside an RTL page — intentional for emails/phones).

---

## 8. i18n key inventory (client screens)

`welcome, welcomeSub, newProjectCta, newProjectSub, statActive, statBriefsDone, statProposals, statSaved, myProjects, viewAll, thProject, thBudget, thTimeline, thStatus, thDate, stDraft, stBrief, stMatched, stSelected, stInprogress, stCompleted, chatTitle, chatSub, chatOnline, chatScripted, chatLive, liveNote, chatPlaceholder, chatSend, chatStarter1..3, chatHello, generateBrief, generating, genStep1..4, briefKicker, briefReady, briefEdit, briefSaveEdit, briefApprove, briefApprovedToast, bSummary, bObjective, bScope, bDeliverables, bMilestones, bBudget, bTimeline, bComplexity, bSkills, bProviderType, bCriteria, bMissing, matchesTitle, matchesSub, matchBasis, matchScore, whyMatch, verifiedBadge, yearsExp, perProject, requestProposal, proposalSent, proposalRequested, viewProfile, backToProjects, pdStatusT, pdSteps[5], pdBriefT, pdViewBrief, pdProvidersT, pdNoProviders, pdGoMatches, pdActivityT, pdActivity[4], cpTitle, cpSub, clientPerson, clientName, memberSince, memberSinceV, cpEdit, cpOrgType(V), cpSector(V), cpLocation(V), cpEmailV, cpPhoneV, lfEmail, sfPhone, pfLangs, demoOnly` — plus sidebar keys `cNavHome/cNavNew/cNavBrief/cNavMatches/cNavProjects/cNavSettings` (badges "1" on Brief and "6" on Matches appear once `briefReady`).

## 9. Handler inventory (client screens)

| Handler | Effect |
|---|---|
| `goChat` / `goProjects` / `goBrief` / `goMatches` | set `cPage` + scroll top |
| `p.open` | `cPage='detail'` + scroll top |
| `setScripted` / `setLive` | toggle `liveMode` (live also `ensureHello()`) |
| `s.go` (starter) | `startScript(text)` |
| `c.go` (chip) | `answerScript(text)` |
| `onDraft` / `onDraftKey` / `sendDraft` | controlled input; Enter or button → `send(draft)` then clear |
| `generate` | `generateBrief()` — 850ms×5 staged overlay → brief page |
| `toggleEdit` | flip `editing` |
| `onEditTitle` / `onEditSummary` / `onEditBudget` | merge into `state.edits` |
| `approveBrief` | `editing=false, briefReady=true, cPage='matches'`, toast |
| `mc.request` | `proposals[pid]=true`, toast `proposalSent` |
| `demoToast` | toast `t.demoOnly` |

## 10. Rebuild notes
- Model state as a client-side store (Zustand/Context): `cPage`, chat state, `edits`, `proposals`, `briefReady`, `toast`, `lang`.
- `window.claude.complete` (live mode) must be replaced by an API route calling the real LLM; keep the same system prompt, `max_tokens: 400`, and the `chatDone` heuristic (`liveHistory.length >= 3`).
- Preserve exact ms timings (1100 / 1000 / 850 / 2600 / 60ms scroll) and keyframes for fidelity.
- All hover/focus styles listed above map to `hover:`/`focus:` variants; grids should collapse responsively (prototype relies on `flex-wrap` only; add sensible `md:` breakpoints for the 2-col grids).
