# Infame / إنفيم — paused implementation handover

Saved 2026-10-06, approximately 06:27 Asia/Riyadh, at the founder's explicit
request to summarize and stop because the conversation has about 2% context left.
The goal is **paused**, not complete. All active agents, including the UI worker's
review child, were interrupted. No test/build process remained running in the
final process inventory. The local website and disposable PostgreSQL remain running.

## Founder decisions to preserve

- Use **Talaqee's complete platform layout and page composition**, changing the
  Infame name/colors and adding features inside that structure. Do not redesign
  the dashboard or replace it with a Studio starter.
- `/` is the selected public website. `/classic` remains a reference version.
- The approved overlapping circles, dot and eight-point spark define the brand.
  Shared yellow/coral/rose/purple/ink tokens, component, SVG and palette JSON are
  saved and used across the site and quiet platform accents.
- New campaigns are managed Infame services: the company buys Infame's campaign,
  and Infame separately procures creator services. Preserve accepted legacy
  agreements and their actual parties/history.
- Optional company/agency AI subscriptions limit usage. The approved planning
  defaults are SAR99/299/999 monthly excluding VAT for 3/15/75 pooled sessions;
  manual planning remains free. These are implementation-plan defaults, not
  enabled billing or validated market results.
- SAR5,000–10,000 is an indicative initial managed estimate range, not fixed
  packages, a universal floor or a guaranteed creator count. The plan targets
  30% forecast contribution margin, a 25% commitment floor and five concurrent
  pilot campaigns. Live commercial/tax/payment acceptance remains outstanding.
- Reach bands are per platform: Nano1k–<10k; Micro10k–<100k; Mid100k–<500k;
  Macro500k–<1m; Mega≥1m. Below1k/unknown remains unclassified. Fame is separate;
  no A/B/C quality grades were selected.
- Add a guided campaign agent that collects all campaign information, proposes
  original-language facts for confirmation and generates a complete campaign
  profile only when required facts validate. Support text, private media, voice
  messages and live voice; text/voice/both output choices are independent.
- **OpenAI stays disabled.** Do not create credentials, purchase services,
  publish externally, send outreach or move money without existing authorization.

## Repository and environment

| Item | Current state |
| --- | --- |
| Active checkout | `C:/Users/Asus/Claude_Code/Infame` |
| Branch / HEAD | `infame/managed-platform` / `88affac545093dca81a64ba4b9e3ea37b7434f4f` |
| Commit state | Current M03, identity and reference changes remain **uncommitted**. No push/deployment occurred. |
| Original source | `C:/Users/Asus/Claude_Code/Talaaqe/talaqi`, read-only; HEAD `b001002526c7952da97268c75dbeb9ae21414d9b` |
| Original work preserved | Same existing README modification, root proxy deletion and untracked `scripts/check-fork.sh` / `src/proxy.ts`. |
| Task identity | `infame_5fd9729e41dc` |
| Databases | Separate dev/test/E2E targets on loopback5644; all **18 migrations** applied, no reset. |
| Toolchain | Node24.19, npm12.1, Next16.3.8, React19.2.4, Prisma6.19.3 |
| Website | `http://localhost:3000/`; `/classic` also verified200 after restart. |
| Final listeners | Infame Next on127.0.0.1:3000; PostgreSQL on127.0.0.1:5644. No3100 listener. |

Preview exec handle97855 was intentionally left running. Its final listener PID
was37952 and PostgreSQL PID23212; **re-query before any future process action**.
No active gate/test handle needs resuming. Secrets and local fixture configuration
remain in ignored task files; none are copied into this report.

## Implemented and reviewed foundations

The retained platform already has current-session/role/ownership enforcement,
original-language profiles and publication checks, private evidence/trust review,
exact-money campaign/brief/deal foundations, deterministic explained matching,
agency organizations/client grants, private creator collections and reviewed
failure/replay/revocation behavior. Existing accepted direct agreements remain
readable with their frozen parties and briefs. These foundations do not mean the
entire managed platform or original MVP is finished.

Current M03 work adds optional original-language brand contexts, exact OWN_BRAND
or CLIENT workspaces, immutable submitted/approved context versions, explicit
NONE or approved-version campaign selection, reviewed tone reuse, literal
UNPROCESSED chat/paragraph persistence, canonical full manual campaign profiles,
brief generation/provenance and the actual Brand owner's submitted-review lane.
The list/new/detail/brief/review screens retain Talaqee composition. Same-Brand
clients remain separate and owner review requires no invented agency seat.

Campaign recovery preserves exact command identity and original words after lost
or contradictory replies. Backward version cursors retain exact boundaries.
Shared dashboard links/logout and real browser Back now use the campaign dirty
guard, with Keep/Discard and no fabricated history entries. Independent race and
hard-failure tests cover duplicate continuations, caller cancellation, interrupted
rollback, newer navigation and bounded traversal failures.

## Private reference files — current working backend

Five additive sidecars bind immutable marketing-reference assets to exact context
workspaces, preserve ordered manifests/current state, capture submitted manifests
and record scalar-only command receipts. Approved versions derive files through
their immutable source submission. Original text hashes and strict historical
campaign/brief JSON stay unchanged. Old absent lineage remains LEGACY_ABSENT;
new empty submissions capture explicit empty manifests. Campaign NONE is distinct.

UPLOAD and REPLACE enforce native plan authority, parent/reference revisions and
exact replay. Reference-only edits preserve text inputRevision but stale pending
approval, including ABA. View readers and actual-owner submitted readers cannot
use generic uploader/admin access. Generic evidence download/list paths explicitly
exclude MARKETING_REFERENCE. Files pinned to approved context/campaign submissions
survive draft removal/archive. Missing, corrupted or unavailable bytes return503.
Metadata reads and REPLACE work without a storage provider; bytes require one.

Limits are20 manifest items,64KiB compact metadata and10MiB per PNG/JPEG/WebP/PDF.
Signature inspection is **not malware scanning**. Audio/video require separate
campaign-media purposes/limits; proof assets cannot be repurposed.

Migration17 installed the sidecars and guards. Native inserts exposed a PL/pgSQL
alias ambiguity; migration18 corrects only that function. **Do not edit either
applied migration or reset databases.** Prisma generation needed a temporary stop
of the verified Infame Next preview because Windows held its DLL; generation and
preview restart succeeded. Other processes/source work were preserved.

Seven real reference APIs are implemented:

- Context current/version metadata, UPLOAD/REPLACE and scoped binary download.
- Actual context-owner submitted metadata/download.
- Actual campaign-owner submitted-pinned metadata/download.

Transport authenticates before body/query parsing, rejects duplicate/unknown
parts/query fields, preserves Arabic through fatal UTF-8 JSON Blob decoding, bounds
multipart/file/JSON sizes and actual20-second timeout/abort, and returns private
attachment/security headers. The reference DTO includes contextId, parent revision,
inputRevision and archive state from the same authorized locked frame, so a client
can bind current reads and receipts without pairing racing GETs.

## Design and agent readiness

Brand assets: `public/brand/infame-pattern.svg`, `infame-palette.json`, shared
`brand-pattern.tsx`, tokens in globals.css and `docs/BRAND_IDENTITY.md`.

The existing Studio account was actually authenticated. Radix ChatBubble01 and
FileUpload02 source ZIPs were downloaded and inspected outside Git in Downloads.
Hashes/provenance/dependency/RTL notes are in `docs/SHADCN_RESEARCH.md`. Their demo
Sent states, simulated uploads, unrestricted defaults and floating/resetting chat
history must be replaced. Connected Figma hit its current Starter MCP call limit;
no account/plan change was made.

**The guided AI agent and voice are not working yet.** The existing AI budget
ledger is a tested foundation, not a product-provider orchestrator. No genuine
AI/speech provider was enabled. Confirmed-fact extraction, campaign media lineage,
pooled entitlements, actual Anthropic orchestration, transcription, speech and
live-voice remain required under `docs/plans/09-campaign-agent.md`.

The private-file UI is **not mounted**. A Studio-derived candidate is saved at
`tmp/context-reference-files.draft.txt` (53850 bytes at stop), with atomic DTO
binding and recovery intent. Its independent child check was interrupted; it is
not UI acceptance. The three-journey E2E draft was being authored and no completed
`tmp/context-references-e2e.draft.txt` was present in the final inventory. Recovery
labels/selectors and parent dirty/pending integration remain to reconcile.

## Verification — exact scope and limits

| Evidence | Result |
| --- | --- |
| Campaign/navigation/identity full gates |1030 tests /110 files; TypeScript, zero-warning ESLint, production build/privacy passed. |
| Full retained browser regression |173 passed, one unchanged intentional skip,8.9m; **before migrations17/18 and new file APIs**. |
| Reference-backend full gates |1034 tests /111 files,190.40s; all four gates passed;176 deployment manifests/34158 references/zero private development paths. **Before later owner-reader/atomic DTO/API additions.** |
| Expanded four native reference groups |Passed after owner-reader additions; atomic DTO correction first failed4/4, then4 passed3.01s. |
| Native reference API groups |Meaningful2/2 RED on inert503, then2 passed22.34s with actual local files, signed sessions and real20-second stalled/abort behavior. |
| Latest TypeScript/scoped ESLint |Passed after the active owner/atomic DTO/API work. |
| Independent source reviews |DDL fixes, owner/optional-storage readers, atomic DTO and seven transport handlers cleared within assigned scopes. |

Native byte-map/local-file and signed synthetic fixtures are not live cloud,
provider, legal, payment or customer acceptance. A transient Radix hidden-checkbox
hydration style warning appeared in the earlier screenshot-producing legacy
browser case; it is recorded in PROGRESS, not described as warning-free browsing.
The **latest full merged gates and browser upload journeys still need running**
after the file UI is integrated. Do not claim1036 full tests passed: only the new
two API groups ran separately after the1034 checkpoint.

## Resume order

1. Read this report, AGENTS.md, docs/CONTRACTS.md and the latest PROGRESS entries.
   Resume the paused goal only on the founder's direction. Use infame-start to
   reconcile services/task identity; never reset or regenerate secrets on resume.
2. Preserve the uncommitted tree and unrelated Hypefy/Sanad research, output/tmp
   artifacts and mixed PROGRESS edits. Stage only explicitly owned paths later.
3. Review the saved file UI candidate and reconcile parent revision/dirty/pending,
   denial clearing, focus, exact UNKNOWN retry and confirmed GET-only recovery.
4. Finish exactly three native browser journeys across Arabic360 RTL/English LTR.
   Mount inert panels, observe meaningful RED, then activate the reviewed UI.
   Cover OWN upload/removal, exact CLIENT/owner pinned files, and lost-reply/
   revocation recovery. Run relevant/full browser regression and all four gates.
5. Complete full M03 before its declared full-flow commit. Continue D067 guided
   multimodal agent with dedicated campaign-media/consent/retention lineage,
   pooled quotas and metered provider orchestration; confirm complete facts before
   generating a campaign profile. Keep missing provider capabilities honest.
6. Continue the approved managed-platform dependency order and original carryover:
   M04–M15 estimates/procurement/retail and supplier agreements, payments/refunds,
   deliverables/reviews/deadlines, inbox/notifications, outcomes, AI subscriptions,
   portfolio/media kit, settings/export/deletion, administration and remaining
   import/social/phone/invitation/PWA/SEO/Cloud readiness. See the authoritative
   `09-managed-platform.md` and `09-original-mvp-carryover.md` checklists.

Primary handoff files: `docs/PROGRESS.md`, `docs/OWNERSHIP.md`,
`docs/DECISIONS.md`, `docs/CONTRACTS.md`, `docs/plans/09-m03-reference-assets.md`,
`docs/plans/09-campaign-agent.md`, `docs/BRAND_IDENTITY.md`,
`docs/SHADCN_RESEARCH.md`. Owned candidate texts are exactly locally excluded;
other untracked tmp/research work is preserved. No implementation continues after
this report until the founder resumes it.
