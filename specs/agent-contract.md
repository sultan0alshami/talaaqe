# Talaqi Screen-Builder Contract

You are building screens for a **real, production Next.js 16 App-Router app** (TypeScript, React 19, Tailwind v4) that recreates a high-fidelity HTML prototype **pixel-faithfully**. The foundation (auth, i18n, API, DB, shells) is DONE — build only your assigned screens on top of it.

## Absolute rules

1. **NEVER create or edit files outside your assigned file list.** Shared files (`src/lib/*`, `src/components/shells/*`, `src/components/ui/*`, layouts, API routes, prisma) are read-only for you.
2. **Pixel fidelity**: copy exact colors/px/gradients/radii/shadows from your spec file + the prototype HTML. Use **inline React `style` objects** (the prototype is inline-styled — this is the house style for screens). Use Tailwind classes ONLY for hover/focus states, e.g. `className="hover:bg-[#24437F]"` (add `!` suffix like `hover:text-[#1B3568]!` if an inline style must be overridden — inline styles beat classes otherwise).
3. **RTL-safe**: use CSS logical properties in style objects (`marginInlineStart`, `insetInlineEnd`, `borderInlineStart`, `paddingInline`, `textAlign: "start"`). Never `left/right/marginLeft` except where the prototype deliberately uses physical corner radii on chat bubbles.
4. **All user-visible strings come from the i18n dict** — never hardcode UI copy. Emails/phones/skill names render `dir="ltr"` inside RTL.
5. Numbers use `fmtNum`/`fmtBudget` from `@/lib/format` (Western digits, `toLocaleString` commas).
6. After finishing, run `npx tsc --noEmit` from `C:/Users/Asus/Claude_Code/Talaaqe/talaqi` and fix YOUR errors (ignore errors in files you don't own).

## Architecture pattern (follow exactly)

- **Server page** (`src/app/.../page.tsx`): async server component. Reads session via `getSession()` from `@/lib/auth` (dashboards are already role-guarded by proxy.ts), queries Prisma via `prisma` from `@/lib/prisma` (or uses DTO mappers from `@/lib/dto`), passes plain-JSON props to a client screen component. `params`/`searchParams` are **Promises** — `const { id } = await params;`.
- **Client screen component** (`src/components/screens/<area>/<name>.tsx`): `"use client"`, receives data props, renders UI, calls `useI18n()` for language.
- Mutations: `fetch("/api/...", { method, headers: {"Content-Type":"application/json"}, body })` from client components; then update local state optimistically AND/OR `router.refresh()`.

## Foundation APIs you consume

### i18n — `@/lib/i18n`
```tsx
const { t, isAr, lang, dir, dirOpp, arrowChar, pick, toggleLang, setLang } = useI18n();
t.heroTitle1            // typed dict (shape of I18N.ar from @/lib/talaqi-data)
pick(row.titleAr, row.titleEn)  // localized pick of bilingual data
```
The dict has ALL keys from the prototype (`t.plans`, `t.how`, `t.features`, `t.aboutVals`, `t.pdSteps`, `t.notifs`, arrays included). Check `src/lib/talaqi-data.ts` for exact key names.

### Toast — `@/components/ui/toast`
```tsx
const { showToast } = useToast();  showToast(t.proposalSent);
```

### Status chip — `@/components/ui/status-chip`
```tsx
<StatusChip status={project.status} />   // ProjectStatus enum value
<StatusChip status={status} large />     // detail-header variant
```

### Generation modal — `@/components/ui/generation-modal`
```tsx
<GenerationModal active={generating} apiDone={briefDone} onDone={() => router.push(...)} />
```

### Domain helpers — `@/lib/domain`
`statusChip(status)`, `journeyStep(status)` (0–4), `scoreColor(score)`, `PROVIDER_TYPE_LABELS`, `AVAILABILITY_LABELS`, `COMPLEXITY_LABELS` + all DTO types (`ProjectListItemDTO`, `ProjectDetailDTO`, `BriefDTO`, `MatchDTO`, `ProviderCardDTO`, `OpportunityDTO`, `ChatMessage`, `ActivityDTO`, `Milestone`).

### Format — `@/lib/format`
`fmtNum(n)`, `fmtBudget(min,max)` ("4,000–8,000" or "—"), `fmtDate(d)` ("2026/06/28"), `fmtWhen(d, lang)` ("اليوم 10:24 ص"), `fmtAgo(d, lang)` ("قبل 10 دقائق").

### Prisma (server pages only) — `@/lib/prisma` + `@/lib/dto`
Includes/mappers ready to use: `projectListInclude`+`toProjectListItem`, `projectDetailInclude`+`toProjectDetail`, `providerCardInclude`+`toProviderCard`, `toBriefDTO`, `toMatchDTO`, `opportunityInclude`+`toOpportunityDTO`, `messagesOf(conversation.messages)`.

## REST API (all return JSON; errors are `{error}` with 4xx/5xx)

Auth: `POST /api/auth/signup` `{role:"client"|"provider", name, email, password, phone?, company?, city?, categoryId?, language?}` → sets session cookie. `POST /api/auth/login` `{email,password}`. `POST /api/auth/logout`. `GET /api/me`. `GET /api/categories` → `{categories:[{id,nameAr,nameEn,count}]}` (public).

Client: `POST /api/projects` `{description, mode:"live"|"scripted", lang}` → `{projectId, messages, ready, mode, chips}`; `GET /api/projects` → `{projects: ProjectListItemDTO[]}`; `GET /api/projects/:id` → `{project: ProjectDetailDTO, conversation:{messages,questionsAsked,readyForBrief}|null}`; `POST /api/projects/:id/chat` `{message, mode, lang}` → `{messages, ready, mode, chips}`; `POST /api/projects/:id/brief` `{lang}` → `{brief: BriefDTO, mode}` (takes 5–30s live — run alongside the GenerationModal); `PATCH /api/projects/:id/brief` `{title?, summary?, budgetMin?, budgetMax?, timeline?}`; `POST /api/projects/:id/brief/approve` → `{matches: MatchDTO[]}`; `GET /api/projects/:id/matches`; `POST /api/matches/:id/request-proposal`.

Provider: `GET /api/provider/profile` → `{profile}`; `PATCH /api/provider/profile`; `GET /api/provider/opportunities` → `{opportunities: OpportunityDTO[]}` (statuses RECOMMENDED/ACCEPTED/DECLINED); `POST /api/provider/opportunities/:matchId/accept|decline`; `GET /api/provider/requests` → `{requests: OpportunityDTO[]}` (PROPOSAL_REQUESTED/PROPOSAL_SENT); `POST /api/provider/requests/:matchId/send-proposal|decline`.

Admin: `GET /api/admin/overview` → `{users,clients,providers,projects,weekly,briefs,pending,matchRate,topCats:[{ar,en,v}],pendingProviders:[{id,nameAr,nameEn,roleAr,roleEn,cityAr,cityEn,date}]}`; `GET /api/admin/users` + `PATCH /api/admin/users/:id {active}`; `GET /api/admin/providers` + `POST /api/admin/providers/:id/approve|reject`; `GET /api/admin/projects`; `GET /api/admin/briefs` (BriefDTO + clientAr/En + categoryAr/En + createdAt each) + `PATCH /api/admin/briefs/:id {qualityScore}`; `GET /api/admin/analytics` → `{avg,accept,timeAr,timeEn,dist:[{rAr,rEn,v}],weekly:number[7],rev:{mrr,subs,growth}}`; `GET/POST /api/admin/categories`, `PATCH/DELETE /api/admin/categories/:id`; `GET/POST /api/admin/skills`, `DELETE /api/admin/skills/:id`.

## Shells (already built — your screens render INSIDE them)

- Dashboard pages are wrapped by role layouts (`src/app/client/layout.tsx` etc.) that render the top bar + sidebar. Your page content starts directly with the screen container (e.g. `<div style={{maxWidth:1000, margin:"0 auto"}}>`).
- Public pages are wrapped by `src/app/(public)/layout.tsx` (sticky nav + navy footer). **Public pages MUST live under `src/app/(public)/`** e.g. `src/app/(public)/about/page.tsx`.
- Settings pages exist already. Do not build settings.

## Data & accounts

Seeded demo accounts (password `talaqi123`): client `ahmed@oudalkhaleej.sa` (Ahmed, Oud Al-Khaleej, owns the perfume project with brief + 6 matches + activity), provider `abdullah.dev@gmail.com` (Abdullah, 3 opportunities + 1 proposal request), admin `ops@talaqi.sa`. 16 categories, 20 providers (4 pending approval), 9 projects, 5 briefs.

`ANTHROPIC_API_KEY` is configured — chat "live" mode calls Haiku; "scripted" mode replays the perfume interview. Both work through the same endpoints.

## Reference files

- Your screen spec: `C:/Users/Asus/Claude_Code/Talaaqe/talaqi/specs/<assigned>.md` — exhaustive styles per screen.
- Behavior spec: `C:/Users/Asus/Claude_Code/Talaaqe/talaqi/specs/behaviors.md` — timings, state machines, interactions.
- Raw prototype HTML (ultimate truth for pixel details): `C:/Users/Asus/Claude_Code/Talaaqe/Talaqi AI Procurement Platform/design_handoff_talaqi_backend/Talaqi Platform.dc.html` (your assigned line range).
- i18n dict + demo data: `C:/Users/Asus/Claude_Code/Talaaqe/talaqi/src/lib/talaqi-data.ts`.
- Shell/UI source (read for style consistency): `src/components/shells/*`, `src/components/ui/*`.

## Quality bar

- Loading/empty/error states for every data view (spec §5.11 empty pattern; simple muted text + soft CTA).
- Buttons disable while a mutation is in flight.
- Language toggle must re-render everything instantly — never cache a localized string in state; always render from `t`/`pick` at render time. (Chat messages are the exception: they render the language they were written in via stored ar/en pairs.)
- Timings from behaviors.md are exact: typing indicator ≥1000ms before scripted replies, 850ms generation ticks, 2600ms toasts.
