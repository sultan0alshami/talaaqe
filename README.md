# Infame / إنفيم

Arabic-first influencer collaboration platform being adapted from Talaqee, with worldwide Arab creator/brand onboarding and deeper Saudi موثوق support. The approved direction is Infame-managed campaigns with separate creator procurement and optional limited AI subscriptions. Manual planning remains free. Accepted legacy direct agreements retain their original parties and terms. Payments and paid AI activation remain unavailable pending implementation and genuine readiness.

Creator portfolio → brand-approved campaign brief → deterministic explained shortlist → offer/counter → two-party agreement → delivery → sealed mutual ratings.

This checkout retains Talaqee history from b001002526c7952da97268c75dbeb9ae21414d9b. Infame was developed on isolated conversion branches and is being handed over to main at the founder's request. The original source working tree remains untouched. The inherited Next/React/Prisma/PostgreSQL/Anthropic infrastructure is reused deliberately, not replaced by a new scaffold.

Development foundation is implemented and reviewed; Infame domain/product phases are in progress. Current checks/status and unresolved external acceptance are in [docs/PROGRESS.md](docs/PROGRESS.md). This is not a launch-ready claim.

The external collaboration organizer is work in progress: its normal browser journeys pass, but review findings on session-denial clearing, uncertain/confirmed save recovery, upload cancellation, timestamp precision, response validation and touch targets remain open. See the [full status report](docs/STATUS_REPORT_2026-10-13.md) and [visual report](output/reports/Infame-Progress-Report-2026-10-13.html). These reports are dated snapshots; current verification is recorded in PROGRESS. OpenAI remains disabled.

```bash
npm ci
npx prisma generate
npm run setup:local
npm run db
# In another terminal:
npm run db:prepare
npm run db:prepare:test
npm run db:prepare:e2e
npm run dev
npm run check
npm run test:e2e
```

Use Node24/npm12 and the lockfile. Setup generates ignored credentials and separate task-bound dev/test/E2E databases on loopback; never copy source .env/data or use Talaqee5544. Seeds are small, synthetic and idempotent. Startup never resets data.

- [Development and safe reset](docs/DEVELOPMENT.md)
- [Prepared Cloud install/start/publication workflow](docs/CLOUD_SETUP.md)
- [Source audit/reuse inventory](docs/REUSE_INVENTORY.md)
- [Shared contracts](docs/CONTRACTS.md), [decisions](docs/DECISIONS.md), [ownership](docs/OWNERSHIP.md)
- [Dependency-ordered plans](docs/plans), [full handoffs](docs/handoff)
- [Founder/provider/legal dependencies](docs/FOUNDER_DEPENDENCIES.md)

Historical specs under specs/ describe Talaqee. Their inline-style/demo/fresh-fork assumptions are superseded by AGENTS.md and the Infame contracts. No demo credentials, fake traction or fixed AI output are Infame acceptance. Local tests do not prove actual Cloud publication, live providers or supported-phone Arabic voice.
