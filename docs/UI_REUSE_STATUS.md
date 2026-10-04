# Talaqee interface reuse status

2026-10-04. Founder direction D019a makes immutable Talaqee `b001002526c7952da97268c75dbeb9ae21414d9b` the full platform visual baseline. Source checkout is read-only. Existing Infame data, actor checks, revisions, explicit approvals and failure states must remain intact while adding them within original page patterns. Original-language user content is not branding copy.

## Current reviewed checkpoint

- The original public website composition is available separately at `/classic`, with original navigation/hero/illustrative pipeline/process/value/features/categories/pricing/footer and supporting pages. It uses Infame name/colors/content, authentic shared auth, explicit unavailable contact delivery and unpublished legal notices. The previously approved `/` retains its own composition.
- Original desktop/mobile dashboard shell, brand/creator home, campaign rows, opportunity/deal cards, auth form geometry and Settings panels are reused. Role home counts and recent rows come from authorized current data. New brief/matches/sidebar routes enforce role and ownership independently of navigation.
- Original creator900px/brand860px owner profile pages are mounted separately at `/creator/profile` and `/brand/profile`. Identity/avatar, six fact cards and services/portfolio panels use the retained original composition with canonical owner data. Edit actions return to durable onboarding; private representative information stays on the authorized owner page. Saved state and self-reviewed portfolio wording do not imply accepted ownership or legal authority. Arabic360px/English360px and keyboard skip access passed current inspection; expanded role profile/edit/resume/denied-session regression passed within21 browser tests and one intentional duplicate skip. The corresponding code gates passed400 tests and actual deployment trace privacy.
- Retained source screen literals are mapped to semantic Infame colors; controlled dictionary branding is changed, not fixture or stored content. Shared workflow CSS restores headings, radii and padding, but does not by itself restore every populated leaf composition.
- `proof_integration` independently reviewed current routes, projection predicates, auth links and failure-state accessibility. `evidence_surface` independently inventoried remaining populated leaf mappings below. These source reviews are separate from actual browser regression and do not establish full platform or live provider acceptance.

## Remaining page mappings

Original paths below are relative to the immutable source; active paths are relative to this checkout. Priority is presentation dependency order, not authorization to replace working domain behavior.

| Priority | Active Infame surface | Original Talaqee pattern | Required integration |
| --- | --- | --- | --- |
| 1 | `src/app/brand/brief/page.tsx`; `campaign-screen.tsx` | `src/components/screens/client/brief-screen.tsx:150` | Populated approved brief uses the900px1.6:1 summary and budget/period sidebar. Preserve generation, review, explicit approval, version/history and stale recovery. Empty original brief is already reused. |
| 1 | Guided conversation in `campaign-screen.tsx` | `src/components/screens/client/chat-screen.tsx:243` | Reuse780px joined header/canvas/composer and original bubbles around saved canonical conversation and real asynchronous states; keep manual input and honest unavailable AI. |
| 1 | `src/components/infame/matches-screen.tsx` | `src/components/screens/client/matches-screen.tsx:84` | Reuse horizontal identity/score/action cards with22x24px padding and16px gaps; fit confidence, sources, partial/unknown warnings and exact quote detail beneath them. |
| 2 | `deal-screen.tsx`, `deal-compose.tsx`, `deal-editor.tsx` | `src/components/screens/client/project-detail-screen.tsx:27`; `provider/requests-screen.tsx:69` | Reuse stepper and1.5:1 details around genuine terms, frozen brief, messages and history. Preserve recipient rules, counters, confirmations, replay and exact money. Composer still needs original heading/width geometry. |
| 2 | `src/components/infame/public-portfolio.tsx`; public creator/brand pages | Original profile identity/facts/portfolio panels above | Reuse profile presentation with sanitized public DTOs; exclude private contact and evidence. |
| 3 | `src/app/admin/**` loaders and retained admin screens | Original corresponding `src/components/screens/admin/**` | Visual1040px tables/panels remain. Replace legacy procurement queries/taxonomy with canonical creator/campaign/brief/niche and audited evidence queues as those features are integrated. |

Settings capability work, evidence/import adoption, invitations, notifications, PWA, Cloud setup and live external evidence remain governed by the domain plans. No full interface or MVP completion is claimed at this checkpoint.
