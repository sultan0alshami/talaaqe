# تلاقي | Talaqi — AI Procurement & Execution Platform

> **Describe → AI Understands → AI Creates Project Brief → AI Matches → Execute**

Talaqi is a bilingual (Arabic-first RTL / English) SaaS platform for the Saudi/GCC market. It is **not** a freelance marketplace — it is an **AI Procurement & Execution Platform**: a client describes a service need in plain language, the AI asks up to 5 clarifying questions, generates a structured 13-item Project Brief, the client edits/approves it, and a deterministic matching engine recommends the best-fit service providers with a match score and a human-readable reason.

*"تلاقي هو نظام تشغيل ذكي للخدمات المهنية، يبدأ من فهم احتياج العميل وينتهي بترشيح أنسب مقدم خدمة."*

## Stack

- **Next.js 16** (App Router, Turbopack) + TypeScript + React 19 + Tailwind v4
- **PostgreSQL + Prisma 6** (local zero-install Postgres for dev; drop-in Supabase swap)
- **Auth**: email/password + JWT sessions (httpOnly cookie, role claim `CLIENT | PROVIDER | ADMIN`), `proxy.ts` route guards
- **AI**: server-side only, two interchangeable providers — Anthropic (`claude-haiku-4-5` for chat turns, `claude-sonnet-4-6` for briefs; preferred when both keys are set) or Google Gemini (`gemini-3.5-flash` with automatic `gemini-3.1-flash-lite` fallback, structured output for briefs) — zod-validated JSON, one retry, scripted demo fallback when no key. On brief approval an AI layer re-ranks the deterministic engine's top 12 candidates and writes one specific bilingual reason per provider (deterministic ranking + template reasons when no key)
- **i18n**: Arabic default (`dir="rtl"`), instant AR↔EN toggle with no reload, complete ~300-key dictionary, CSS logical properties throughout

## Quick start

```bash
npm install
cp .env.example .env        # fill AUTH_SECRET; add ANTHROPIC_API_KEY or GEMINI_API_KEY for live AI
npm run db                  # terminal 1 — local PostgreSQL (embedded binaries, no install)
npx prisma migrate dev      # terminal 2 — create schema
npm run seed                #             — load demo data
npm run dev                 #             — http://localhost:3000
```

### Demo accounts (password: `talaqi123`)

| Role | Email | What you'll see |
|---|---|---|
| Client | `ahmed@oudalkhaleej.sa` | Perfume-store project with brief, 6 ranked matches, activity log |
| Provider | `abdullah.dev@gmail.com` | 3 matched opportunities + proposal requests |
| Admin | `ops@talaqi.sa` | Platform overview, 4 pending provider approvals, briefs review, analytics |

The login page also has one-click demo access buttons for all three.

### Switching the database to Supabase

Replace `DATABASE_URL` in `.env` with your Supabase Postgres connection string, then:

```bash
npx prisma migrate deploy && npm run seed
```

## The demo flow (acceptance script)

1. Sign up as a client (Arabic UI) → describe **"أحتاج متجر إلكتروني لبيع العطور"**
2. The AI asks ≤5 focused questions (live Haiku, or the scripted interview without an API key)
3. Generate the Project Brief — 13 fields, bilingual, with budget/timeline/complexity/milestones
4. Edit the budget → approve → the matching engine ranks approved providers across 7 weighted criteria (skills 30%, category 15%, budget fit 15%, experience/availability/rating/portfolio 10% each), keeps the top 6 scoring ≥60; with an AI key, the AI then re-ranks the top 12 and writes per-provider match reasons
5. Request a proposal → the provider sees it, accepts/sends a proposal → every step lands in the project activity log
6. The admin reviews metrics and generated briefs; the language toggle flips the entire app AR↔EN with correct RTL/LTR

## Project structure

```
prisma/            schema + seed (ports the design handoff's talaqi-data.js)
proxy.ts           role-based route guards (Next 16 successor of middleware.ts)
scripts/db.mjs     local embedded PostgreSQL runner
specs/             implementation specs distilled from the design prototype
src/lib/           auth, i18n, AI flows, matching engine, DTOs, rate limiting
src/app/api/       REST API (auth, projects/chat/brief/matches, provider, admin)
src/app/(public)/  landing, about, for-clients, for-providers, contact, login, signup
src/app/client/    dashboard, AI chat, brief, matches, projects, profile, settings
src/app/provider/  opportunities, proposal requests, profile, settings
src/app/admin/     overview, users, providers, projects, briefs, analytics, categories
src/components/    shells (top bar / sidebars / footer) + screens + UI primitives
```

## Design

Rebuilt pixel-faithfully from the high-fidelity prototype in `design_handoff_talaqi_backend/` (navy `#1B3568` / teal `#14969E` / gold `#C6A15B`, IBM Plex Sans Arabic, 16–20px card radii, soft shadows). All UI copy — Arabic and English — is the handoff's final dictionary, ported verbatim.
