# Infame development

Use this isolated Talaqee-derived checkout and npm lockfile. Source revision b001002526c7952da97268c75dbeb9ae21414d9b; conversion branch infame/mvp. Never use the original checkout's configuration or database.

Tested locally on Windows x64: Node24.19.0, npm12.1.0, Next16.3.8, React19.2.4, Prisma/client6.19.3, PostgreSQL18 embedded package18.4.0-beta.17, TypeScript5.9.3, Vitest5.0.3, Playwright1.63.0. Exact resolutions are in package-lock.json. Required Node24 follows Vitest's supported engine and installed runtime. No source runtime declaration existed.

```powershell
npm ci
npx prisma generate
npm run setup:local
npm run db
```

Keep the database runner open. In another terminal:

Before reinstalling packages on Windows, stop application servers and run npm run db:stop. Native database/CSS binaries remain locked while their processes run. The stop command validates the task cluster/port and shuts it down gracefully; resumption preserves data.

```powershell
npm run db:prepare
npm run db:prepare:test
npm run db:prepare:e2e
npm run dev
npm run check
npm run test:e2e
```

The runner uses a generated task-specific data directory under ignored .infame, random credentials and loopback port5644 or the next free port, never5544. Development/test/E2E are different databases. Concurrent mutable commands for the same target refuse while its exclusive lock is held. Independent task checkouts must generate fresh task identities; do not copy .infame or .env files. Development credentials/configuration are never committed or printed.

Initialization is repeatable, reconciles missing local config and refuses mismatches. Resume preserves existing rows and secrets. Prepare applies reviewed migration history with migrate deploy and idempotent synthetic seed; it does not reset. Two source migrations remain unchanged. Task metadata lives in infame_task_meta so Prisma's first migration can apply to an empty public schema. Seeds use example.invalid identities, cannot grant public visibility/admin, and never wipe tables. Generated synthetic login credentials remain only in ignored fixture files.

Tests use the guarded separate test target; browser tests use the E2E target. Do not run DB acceptance tests with an ambient source/shared DATABASE_URL. npm run check invokes all four gates and guards test connectivity/identity. Direct npx vitest run is appropriate only for the pure unit subset until the test configuration guard has run.

Production builds use the supported `next build --webpack` option, followed by an actual deployment-manifest privacy check. On Windows, the current Turbopack build tried to trace a locked task-local browser cookie file. Fixture email transport is excluded from production compilation; `.infame`, `.research`, `.git`, `.pgdata` and `.env*` must never appear in emitted traces. `npm run build` and `npm run check` enforce that boundary. See the [Next CLI reference](https://nextjs.org/docs/app/api-reference/cli/next) and installed output-tracing guide.

When a development preview is running, set `$env:NEXT_BUILD_DIR='.next-e2e'` for checks/builds in a separate PowerShell process. This keeps its `.next` output intact. E2E also owns `.next-e2e`; finish its browser run before building there. Do not close the user's preview just to free a private cookie-file lock.

Safe reset, only when deliberately needed: node scripts/task.mjs reset test --disposable=YOUR_TASK_ID (or e2e). Read the task ID locally without displaying credentials. It refuses development/production, unknown names/ports/directories and missing/mismatched markers. Reset is never part of startup. A lock left by a crashed process needs process verification before removing the exact lock file; do not delete a live PostgreSQL postmaster lock.

Key inventory and nonsecret placeholders: .env.example. Live email/SMS/social/storage/AI credentials are separate Infame credentials. Synthetic delivery modes are labeled and must be rejected by production capability validation. Do not copy source .env values.

Baseline evidence and remaining work: docs/PROGRESS.md and docs/FOUNDATION_REVIEW.md. No actual Cloud, live voice/provider, supported-phone or launch evidence is implied by local startup.
