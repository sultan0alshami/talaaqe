---
name: infame-start
description: Reconcile the current Infame checkout and start its isolated disposable development services.
---

Read AGENTS.md, docs/DEVELOPMENT.md and current progress. Recheck checkout/revision/task ownership. Personal Windows skills/processes/configuration are not Cloud inputs.

Verify Node24/npm12 and lockfile changes. Generate Prisma for the current schema. Never copy a source or another task's .env/.infame files. A new task needs a fresh task identity; the published environment must not contain validation secrets/database artifacts. If inherited artifacts are present, stop and review task isolation before using them. Resume the same task with npm run setup:local, which preserves rows/configuration and reconciles missing files without overwriting.

Start npm run db in a managed background terminal. Native readiness must precede npm run db:prepare, db:prepare:test and db:prepare:e2e. Verify each target using node scripts/task.mjs verify TARGET. Start npm run dev and check an actual HTTP response. Keep service logs free of credentials/transcripts/proof. Reuse existing task services only after identity/health checks; don't assume saved state contains live processes.

Do not reset data on startup. Review any migration changes before deployment. Tests use guarded separate targets and exclusive operation locks. Use npm run check and npm run test:e2e; record current results. If PostgreSQL cannot run on the actual runtime/non-root account, report the failure and prepare/verify an isolated alternative while continuing independent code work.

Supply real integration keys through process environment configuration/Personal vault. Never substitute network-secret proxy placeholders for raw database credentials. Production rejects development fixtures. Report local/code readiness separately from Cloud publication, enabled live-provider proof and production launch.
