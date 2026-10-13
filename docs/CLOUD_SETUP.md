# Prepared Codex Cloud setup

Status2026-10-14: implementation and handoff are pushed to the public repository
https://github.com/sultan0alshami/talaaqe on `main` (implementation checkpoint007117b).
Read [RESUME_HERE.md](RESUME_HERE.md) first. The original Talaqee revision is
preserved on `archive/talaqee-before-infame-2026-10-14`. Older instructions to
select an unpushed infame/mvp branch or avoid the now-authorized remote main are
superseded.

Install commands and the tracked start skill are prepared and Windows-tested.
Actual Codex Cloud environment creation/publication and fresh Linux-task
validation remain unproven. No saved local setup proves Cloud readiness.
Use the current product's environment interface to select this repository/main;
recheck official documentation for its current UI when performing setup. Keep
access private initially. Publishing an environment/deployment is a separate
external action from the already-authorized Git source push.

Prepared Install script:

```bash
node --version
npm --version
npm ci
npx prisma generate
npx playwright install chromium
```

Node24 and locked npm12 are required. npm12 install scripts are explicitly approved for reviewed packages/versions in package.json; platform-specific embedded binary approvals must be reviewed in the actual Cloud runtime. Do not approve all scripts blindly. Package download access is separate from authentication.

Prepared Start skill: .agents/skills/infame-start/SKILL.md. It reconciles source/config, starts task-local services and proves readiness/identity before tests. Each new task needs fresh ignored task identity/secrets. Never publish a snapshot containing .infame cluster state, generated .env files or local fixture credentials; stop validation services and review/remove only known disposable artifacts before publication. Existing tasks retain their own state. Installation does not imply running services survive publication.

Start with Package managers networking, adding exact required official hosts only when the tested workflow needs them. npm package hosts and embedded binaries must actually work on the VM. Browser binaries use cdn.playwright.dev; Google fonts use fonts.googleapis.com/fonts.gstatic.com in the current inherited build. Research hosts include shadcnstudio.com/ui.shadcn.com. Enabled provider hosts must be reviewed with their capability adapters. A hostname allowlist/VPN does not establish native PostgreSQL connectivity.

Runtime DATABASE_URL/AUTH_SECRET and provider keys are process environment-variable requirements supplied through Environment variables/Personal vault. Network secrets are HTTPS proxy placeholders; they cannot supply a raw password to a local PostgreSQL client. .env.example lists key names without credentials. No source secrets or production credentials belong here.

Linux feasibility is unproven until a fresh Cloud task tests embedded binaries. PostgreSQL refuses root; the runner does not create system users. Use an existing non-root task account or a supported disposable task-local service. If unavailable, record the actual failure and verify a separate disposable development PostgreSQL service, with no paid purchase without authorization. Keep independent code work moving.

Required environment validation: locked install/client; actual native loopback connection; dev/test/E2E distinct identities; retained migrations on empty targets; seed twice without changes; safe resume; startup; four gates; browser journeys. Store evidence with revision/platform/date; mark unavailable checks honestly. No test/provider mock counts as live evidence.

After setup is concrete and reviewed, Save then Publish makes prepared state available to new tasks. Validate another new task's startup/isolation before declaring Cloud ready. Changed setup needs Edit, Save and Republish followed by a fresh-task check; an existing task does not inherit those updates. Publication remains a separate explicit external action.

Mobile: create/publish on web or desktop first, then choose the available environment in Codex mobile. Reopen the same task to continue across devices; new tasks have separate work. Commit important source progress. Cloud runs remotely and does not depend on the founder's PC staying awake.
