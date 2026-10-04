# Phase02 — concrete design, shared shells and public/PWA surfaces

Status: planned. Owner: coordinator for product/shared files; design specialist for research/Figma artifacts; independent accessibility/browser reviewer. Prerequisites: phase01 contracts/auth/projection, phase00 selected source/API/licence research and observed design context. No mass component installation/theme reset. Actual customized Figma frames are required to claim a completed handoff.

Founder override2026-10-04 (D019a): the immutable Talaqee source `b001002` is the visual baseline for the full platform. Preserve its page/row/table/card/form/navigation composition, typography and desktop geometry while applying Infame name/colors and adding the authorized features within those patterns. The approved website stays at `/`; an additional `/classic` public site reuses the original Talaqee composition. Historical redesign/bottom-navigation requirements below do not authorize replacing the original interface. Mobile accessibility fixes remain required. Independent review compares actual rendered source patterns and checks existing auth/domain journeys, rather than treating a matching shell alone as full interface acceptance.

Current D019a checkpoint: prerequisites are the existing canonical auth/campaign/matching/deal milestone and immutable source inventory. Coordinator owns shell/auth/shared styles, role home loaders, sidebar routes, retained palette/name adapters and control records. The website specialist owns `src/components/talaqee-site/**`, `src/lib/talaqee-site/**` and `src/app/(talaqee-site)/classic/**`; the platform specialist owns role-dashboard, campaign-list, deal-list and dashboard-parts. Both preserve concurrent edits. Independent reviewer `proof_integration` checks route ownership, projection privacy, classic auth composition and accessibility; coordinator verifies actual Arabic360/English browser behavior and runs four gates. Acceptance covers a separate working original-design website, retained approved `/`, original shell/home/list composition, truthful current data and existing domain regression. Failure checks include repeated signup role-query navigation, unavailable contact input retention, dark-preference status contrast, mobile overflow/menu focus, wrong-role and foreign campaign access, and build trace privacy. Full profile/brief/chat/matching/deal template completion remains a later checkpoint, explicitly inventoried in `docs/UI_REUSE_STATUS.md`; this checkpoint does not complete phase02 or the MVP.

## 02.1 Compatible selected primitives and semantic tokens

- Objective: progressively replace handwritten foundations with selected shadcn/Studio components while preserving useful signatures.
- Prerequisites: aliases/fonts/globals/lock reviewed; CLIhelp/resolved version/initialization/add dry-run; chosen family/block source compatibility/licence verified.
- Allowed paths: coordinator `components.json`, dependency files, `src/components/ui/**`, globals/fonts/theme/config and component tests; design owner composition/research docs only.
- Contracts: ink/off-white/yellow/light/dark tokens; IBM Plex Arabic/Latin; Arabic no letter spacing; real focus/labels/loading/disabled; selected API/source before implementation.
- Failing acceptance: low-contrast yellow text, RTL portal/arrow/focus failure, incompatible primitive props, native keyboard inaccessible dialog, duplicate-inflight submission and uncontrolled360px overflow must be detected in relevant component/browser tests.
- Implementation: preview CLI diff, install only selected primitives, token-map Figma variables, legacy adapters, migrate caller-by-caller; verify button/card/field/input/textarea/select/combobox/checkbox/radio/dialog/drawer/sheet/avatar/badge/tabs/alert/empty/skeleton and actual required variants.
- Failure states: registry/auth/compatibility/licence unknown →public compatible documented choice or pending selection; no force overwrite. Long content and reduced motion have intentional layouts.
- Validation/review: RTL/LTR touch+keyboard+screen-reader/reduced-motion/contrast in real browser; independent design/accessibility reviewer; four gates after coherent integration.

## 02.2 Shared dashboard/navigation/auth/account surfaces

- Objective: coherent creator/brand/admin shell and accessible auth/verification/settings routes.
- Prerequisites:02.1 APIs/tokens;01.2 auth; explicit per-role nav and route ownership.
- Allowed paths: coordinator shared shells/layouts/auth/public navigation/settings; each domain supplies leaf nav entries through typed props.
- Contracts: trusted role nav without relying on nav for auth; Arabic/English instant interface and original-language content; mobile creator/brand bottom nav and complete targets.
- Failing acceptance: wrong-role direct URL/API denied, nav target404,360px clipping, toggle changes stored text, expired session strands without safe login/resume, reset/missing verification has no usable state.
- Implementation: desktop/sidebar and mobile bottom nav, role/account props, locale/theme controls, auth/login/signup/verify/reset/settings/loading/error states. Redirect legacy client/provider public links only when canonical counterpart works.
- Failure states: revoked/session expiry/offline/pending email/OTP/error→explicit accessible retry/signin instructions; no optimistic authorized display of private data.
- Validation/review: Arabic360 and English desktop per role, long handles/names, tab order/safe area; independent verifier tests navigation+direct authorization, not screenshots alone.

## 02.3 Shared live-voice/transcript/bottom-card surface

- Objective: one original Infame conversation surface used by both roles without hiding server state.
- Prerequisites:01.5 shared commands/jobs/caps;00.6 provider prototype; actual selected component APIs/design interactions.
- Allowed paths: coordinator shared onboarding UI/voice/transcript/card components and tests; domain step renderers remain role leaves.
- Contracts: actual READY/LISTENING/PROCESSING/SPEAKING/PAUSED/RECONNECTING/ERROR; mic permission only speaking; full typed path; explicit field confirmation and server revisions.
- Failing acceptance: mic denial must permit typed completion; interrupt immediately stops audio; transcript respects manually scrolled position; refresh/background preserves draft; mobile keyboard cannot obscure card; screen reader not flooded by streamed tokens.
- Implementation: start voice/type choice, actual audio indicator, readable live/provisional transcript, concise completed-turn/status announcements, step label, safe-area cards, mute/stop/replay/back/exit/resume/text/language controls; actual partial jobs/facts and manual fallback.
- Failure states: permission/network/provider/budget/expired session/background→pause/retry/resume/text. Stop speaking does not silently cancel authorized import. No fake progress timers.
- Validation/review: Arabic360/English desktop keyboard+touch/reduced motion, denied mic/partial/resume; real dynamic phone audio evidence separately recorded. Independent reviewer checks controls/state reflect actual integration.

## 02.4 Public pages, metadata and safe PWA

- Objective: all promised public routes with free/direct-payment copy and installable privacy-safe offline shell.
- Prerequisites:02.1 tokens;01.3 projection; typed brand config; reviewed legal drafts labeled pending publication.
- Allowed paths: coordinator public marketing/auth/legal/data-deletion/offline/PWA routes, metadata/canonical/sitemap/service worker/assets; admin later supplies permitted indexed records.
- Contracts: `/`,about,for-brands,for-creators,pricing,privacy,terms,auth,verification/reset,invite/claim,data-deletion exist; no fabricated traction/undecided fees; private responses not cached/indexed.
- Failing acceptance: nav404, unclaimed/hidden/test profile in sitemap, private API available in another account's offline cache, wrong canonical domain, offline action falsely reports success, pricing implies escrow/commission.
- Implementation: responsive real content/placeholder-free data claims; actual route targets; metadata/share cards from allowed projections; install manifest/offline public navigation and explicit unavailable private operation; opt-in push hook only when configured. Founder review before legal publication/external deployment.
- Failure states: offline/private auth/provider data-deletion unavailable→clear action instructions and pending capability; public legal drafts do not claim approved compliance.
- Validation/review: browser install/offline/cache cross-user test, SEO/accessibility, all targets/canonical; independent security/accessibility reviewer. Actual domain/HTTPS/push deployment stays phase08 external evidence.

Phase exit: documented component/design mapping, shared shells/auth/public/card/PWA work at360px RTL and English desktop with meaningful states; licensed source/actual Figma coverage truthful, privacy-safe cache evidence and four gates. Figma/provider unavailability is a recorded dependency, not a fabricated pass.
