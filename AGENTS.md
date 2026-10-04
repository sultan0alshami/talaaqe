# Infame / إنفيم engineering instructions

This isolated Talaqee-derived checkout implements the handoffs in docs/handoff/. Read those specifications and docs/CONTRACTS.md before domain changes. User instructions override historical specs. The original source checkout is read-only.

Keep inherited history/migrations. Reuse audited Next App Router, server pages/client screens, Prisma, auth/API/ownership, bilingual interface and Anthropic foundations. Developer-procurement contracts, demo fallbacks, paired business content, inline-style mandates and fresh-fork/no-migrations scripts are superseded. User content is stored once in its original language; UI translations are separate.

The coordinator owns schema/migrations, auth, shared contracts/env/brand, dependencies, primitives/shells, dictionary composition, CI/deployment. Domain workers own explicitly assigned paths. You share the checkout: preserve other agents' work; ask the coordinator before editing a shared path. Independent reviews return findings to the owner.

Use docs/plans/00-08 in dependency order. A task declares prerequisites, paths, acceptance/failure tests and reviewer. Work test-first for consequential domain behavior. Record current evidence in docs/PROGRESS.md. Never call fixtures or mocked calls live acceptance.

Run all four gates before each commit through npm run check: TypeScript, warning-free ESLint, guarded Vitest and Next production build. The supported Webpack build also checks actual deployment traces for private development paths (D045). Add appropriate migration, browser, ownership, failure and concurrency checks. Use truthful authorship; no fabricated coauthors.

Read relevant installed Next guides in node_modules/next/dist/docs/ before framework code. Keep async cookies/promised params and reviewed proxy behavior. Proxy is an optimistic navigation check; APIs/pages enforce active sessions/roles/ownership independently.

Never copy source .env files, secrets or data. Only task-local Infame databases are disposable. Run npm run setup:local, npm run db and reviewed prepare commands. Resuming never resets data. Fresh tasks need their own task identity. Production rejects synthetic delivery/providers and unsafe seeding. Never log URLs containing credentials, private evidence, raw onboarding transcripts or tokens.

Use semantic tokens, shadcn/Radix-compatible composition and IBM Plex Arabic/Latin. Verify 360px Arabic RTL and English LTR, keyboard/focus, reduced motion, long handles, errors/empty/loading/resume and real asynchronous progress. Never letter-space Arabic or fabricate voice/import activity.

Money uses exact minor-unit strings/BigInt and one ISO currency per campaign/deal. Residence, audience geography, campaign market, interface language and currency are separate. Unknown metrics remain unknown. Matching is deterministic, threshold 60, maximum 12, never padded. Offers, agreement confirmations, ratings, imports and AI limits require transactional actor/state/version checks.

Continue routine reversible work autonomously. No outreach, purchases, registrations, external publication or money movement without explicit authorization. Keep external setup/provider/legal/phone validation dependencies honest.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
