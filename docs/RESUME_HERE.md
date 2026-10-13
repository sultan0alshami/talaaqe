# Resume Infame from any session

Updated October 14, 2026. This is the entry point for a new engineer or agent.
Git and current files are authoritative; the previous chat is not required.

## Repository and current state

- Repository: https://github.com/sultan0alshami/talaaqe.git — **public**.
- Shared base: `main`. Founder authorized the Infame main handoff on October14.
- Latest implementation checkpoint when this guide was written: `007117b`.
- Original Talaqee revision: `b001002526c7952da97268c75dbeb9ae21414d9b`.
- Remote backup: `archive/talaqee-before-infame-2026-10-14`.
- Original Windows source checkout is read-only: `C:/Users/Asus/Claude_Code/Talaaqe/talaqi`.
- Current Windows Infame checkout: `C:/Users/Asus/Claude_Code/Infame`.
- The platform is **work in progress**, not launch-ready. Main includes unfinished
  organizer UI with explicitly recorded review findings below.

First inspect `git status`, fetch the remote and compare the current branch with
`origin/main`. Preserve existing work. Use a fresh feature branch/worktree for
new implementation; never reset someone else's working tree. Do not assume that
the checkpoint above remains the latest after later commits.

## Read in this order

1. [AGENTS.md](../AGENTS.md): ownership, testing, privacy and execution rules.
2. This guide: current continuation and exact unresolved defects.
3. [CONTRACTS.md](CONTRACTS.md), [DECISIONS.md](DECISIONS.md) and
   [BRAND_IDENTITY.md](BRAND_IDENTITY.md).
4. [Approved managed platform plan](plans/09-managed-platform.md), followed by
   the relevant phase plan. Original specifications remain in [handoff](handoff/).
5. [PROGRESS.md](PROGRESS.md): use the newest dated entries; old entries are history.
6. [DEVELOPMENT.md](DEVELOPMENT.md), [CLOUD_SETUP.md](CLOUD_SETUP.md) and
   [external dependencies](FOUNDER_DEPENDENCIES.md).

The [visual report](../output/reports/Infame-Progress-Report-2026-10-13.html) and
[full report](STATUS_REPORT_2026-10-13.md) are October13 snapshots. Their build
failure was fixed on October14; their remaining product/UI gaps still apply.
Do not mistake the report snapshot for current Git/test state.

## Founder decisions that persist

- Keep Talaqee's full platform layout and composition; change branding and add
  Infame features inside it. Do not replace the dashboard with another design.
- `/` is the approved main website; `/classic` remains a reference.
- Use the approved circle/overlap/dot/spark identity and shared Infame palette.
- Arabic-first RTL and English LTR; original user content is stored once.
- New campaigns are Infame-managed services with separate private creator
  procurement. Preserve accepted legacy direct agreements and actual parties.
- AI subscriptions are optional and limited. Manual planning remains free.
- OpenAI remains disabled. Do not create keys or activate providers implicitly.
- The campaign agent must ultimately support text, media, voice messages and
  live voice, with selectable text/voice output and complete confirmed profiles.
- No new outreach, purchases, registrations, money movement or deployment is
  authorized merely by permission to implement or push source.

## Fresh computer or isolated task

Use Node24/npm12 and the committed lockfile. Windows is the verified environment;
Linux/Codex Cloud needs the separate validation described in CLOUD_SETUP.

```sh
git clone https://github.com/sultan0alshami/talaaqe.git Infame
cd Infame
git switch main
git pull --ff-only
git switch -c infame/continue-your-task
npm ci
npx prisma generate
npx playwright install chromium
npm run setup:local
npm run db
```

Keep the database terminal running. In another terminal in the same checkout:

```sh
npm run db:prepare
npm run db:prepare:test
npm run db:prepare:e2e
node scripts/task.mjs verify dev
node scripts/task.mjs verify test
node scripts/task.mjs verify e2e
npm run dev
```

For manual development attachment testing, opt into the guarded task-local file
store before starting dev: PowerShell `$env:EVIDENCE_STORAGE_MODE='local'`, or
POSIX `EVIDENCE_STORAGE_MODE=local npm run dev`. Without this setting, uploads
honestly remain unavailable. Playwright's tracked configuration supplies local
storage for its isolated E2E target. Never use local storage in production.

`setup:local` creates fresh ignored task credentials and distinct dev/test/E2E
databases. Never copy `.env.local`, `.infame`, database files or credentials from
another machine/task. The example file documents configuration names, not secrets.
Never point local tests at production or the original Talaqee database.

For an existing task, `npm run setup:local` preserves its data/configuration.
Verify any running service belongs to that task before reusing it. Resume does
not authorize a reset. Local services do not survive merely because a chat or
Cloud environment was saved. Use the tracked
[infame-start skill](../.agents/skills/infame-start/SKILL.md).

## Immediate next implementation

Finish the external collaboration organizer before calling it accepted.

Relevant paths:

- `src/lib/external-collaborations/{schemas,contracts,service,transport}.ts`
- `src/components/infame/external-collaboration-{list,editor,upload}.tsx`
- `src/components/infame/use-collaboration-leave-guard.ts`
- `src/app/creator/collaborations/` and `src/app/api/external-collaborations/`
- `tests/external-collaborations/` and `e2e/external-collaborations.spec.mts`
- [Owner service plan](plans/09-m12-owner-service.md) and
  [attachment plan](plans/09-m12-attachments.md).

The October14 browser/server schema split fixed the production `node:crypto`
import failure. `schemas.ts` and `contracts/plain-json.ts` must remain browser-safe;
canonical command hashing stays server-side in `contracts.ts`.

Outstanding independent review findings and required failure witnesses:

| Fix | Acceptance witness |
| --- | --- |
| Sticky native-denial clearing | Revoke the real session, submit private input, and verify cards/inputs/pending state clear before decoding any401/403 body |
| Confirmed-write recovery barrier | Save/upload succeeds, next GET fails; retain the confirmed result, prevent new writes against old state, and recover by read |
| Unknown request outcome | Lose the original response; exact retry receives408/429/another error; retain original UUID/body until the original outcome is established |
| Cancel/unmount during hashing | Hold digest completion, cancel or leave, release it; no POST may be dispatched afterward |
| Exact timestamp preservation | Save notes on a period with `.123Z`/`.456Z`; unchanged timestamps must retain their exact instants |
| Bounded and bound responses | Bound response bytes and check operation UUID/action/resource/revision; reject wrong-resource or regressing GET results |
| Accessible checklist control | Provide at least44px touch targets and keyboard/focus coverage |

Do not weaken assertions or discard pending operations to make error handling
look successful. Add meaningful failure tests, obtain independent review and
rerun current gates. Earlier happy-path browser passes do not cover these defects.

## Latest observed verification

Implementation checkpoint `007117b`, October14:

- `npm run check`: TypeScript and zero-warning ESLint passed.
- Guarded Vitest:1,181 tests across162 files passed in410.20s.
- Supported Next Webpack production build passed.
- Deployment privacy:202 manifests/40,781 references; zero private development paths.
- Organizer Arabic360 and English desktop happy paths previously passed2/2 in21s.
- Independent browser-boundary refactor review cleared; organizer UI review still
  requires the fixes above. Tests are local/synthetic, not live-provider evidence.

Validation commands:

```sh
npm run test -- tests/external-collaborations
npm run test:e2e -- e2e/external-collaborations.spec.mts --reporter=line
npm run check
```

When a preview uses `.next`, set `NEXT_BUILD_DIR=.next-e2e` for the check process:
PowerShell `$env:NEXT_BUILD_DIR='.next-e2e'`; POSIX `NEXT_BUILD_DIR=.next-e2e npm run check`.
Do not overlap the check build and browser tests in `.next-e2e`, or run multiple
mutating suites against the same task database. Follow AGENTS gates before commits.

## Remaining platform scope

Continue the full approved plan, not only the organizer: creator work/media-kit
export; account/session/privacy/export/deletion/support; inbox and notifications;
managed quotes, procurement, customer/creator agreements, payments/refunds/payouts,
content approval and reporting; complete Anthropic planning and media/voice;
permitted imports/claims/social connections/referrals; SEO/public utilities;
fresh Cloud/Linux, backup/restore and integrated cross-role acceptance.

See [the complete remaining-work inventory](STATUS_REPORT_2026-10-13.md) and
[final acceptance requirements](plans/08-hardening-beta-handover.md). A green
build or a storage model does not prove an end-to-end business journey is complete.

## What does not travel with Git

- Credentials, authentication cookies, personal vaults and provider accounts.
- Existing local database rows/files; a fresh task creates its own synthetic data.
- Authenticated competitor-account research in `docs/research/hypefy/` and
  `docs/research/sanad/`, `docs/HYPEFY_ADOPTION_REVIEW.md`, local research PDFs,
  portfolio screenshots and `tmp/` scratch artifacts.
- Personal plugin/skill installations, Figma/Studio authentication and permissions.
- Running database/dev-server processes or a published Codex Cloud environment.

These were intentionally not uploaded to the public repository. Their absence
does not block the immediate organizer repairs: code, accepted decisions, plans,
tests and this handoff are tracked. Exact private research evidence requires a
separately authorized private transfer; do not publish it to main to fill a gap.

Cloud environment publication/fresh-task acceptance, live providers/legal/merchant
readiness and production deployment remain unverified. Do not promise that any
machine can run the platform without installing dependencies and satisfying its
runtime requirements.

## Paste into a new session

> Continue Infame from the latest origin/main. Read AGENTS.md and
> docs/RESUME_HERE.md, then verify current Git state and isolated task services.
> Preserve existing work and original Talaqee. First resolve the organizer review
> findings with failure-path tests and independent review, then continue the full
> approved MVP/managed plan. Keep the original dashboard layout and approved main
> website. OpenAI stays disabled. Do not reset data or infer live readiness from
> fixtures. Record exact results in docs/PROGRESS.md and follow repository gates.
