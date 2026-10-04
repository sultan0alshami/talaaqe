# Shadcn catalog research for Infame / إنفيم

Research date: 2026-10-01. Scope: adapt the existing Talaqee application. Product requirements come from the completely read `Mashhoor/docs/infame/AGENT_PROMPT.md` and `REBUILD_PLAN.md`. This report records discovery and design decisions, not MVP completion.

## Coverage and reproducibility

The four official index files were fetched in full: [Studio llms.txt](https://shadcnstudio.com/llms.txt), [Studio sitemap](https://shadcnstudio.com/sitemap.xml), [shadcn/ui llms.txt](https://ui.shadcn.com/llms.txt), and [shadcn/ui sitemap](https://ui.shadcn.com/sitemap.xml). Their linked catalog/documentation URLs were normalized and deduplicated before selection. Nine additional page-category URLs found in the observed Pages gallery links were added beyond the original 614-entry index. Editorial blog/community/ambassador content was excluded from the implementation research index; this is a catalog inventory, not a claim to have read every page of either entire site.

The ignored local cache contains `.research/indexed_urls.json` (623 indexed URLs), `.research/catalog.json` (635 requested records, including supplemental selected docs/source), `.research/overview_digest.json`, and `.research/family_overviews.json`. Fetches ran in bounded batches of 18, concurrency 4, 25-second request deadlines, and a 6 MB response limit. Every manifest record includes URL, fetch time, HTTP result, content type, text length, and SHA-256; no authentication secrets were used by the public crawler.

| Evidence level | Meaning | Observed coverage |
| --- | --- | --- |
| Indexed | URL appears in official llms/sitemap, or a verified CLI registry listing | 623 catalog/documentation URLs; official CLI registry 471 items |
| Fetched | Response cached successfully; this alone does not mean read | 633 successful responses of 635 requests |
| Overview read | Intro/purpose and visible variant summaries inspected in bounded digests | Studio all 57 component-family overviews and all 71 block-category overviews; 122 official canonical/Aria overview entries; 192 Base/Aria/Radix family introductions; all 30 template/gallery overview entries, all 10 page-category introductions and all 10 Figma documentation introductions |
| Selected docs/source read | Complete selected document/source, with family explicit | Radix Button, Card, Input, Textarea, Checkbox, Dialog, Sheet, Direction docs/examples; ten Radix basis source files; five radix-nova styled registry sources; complete cached visible bodies of the ten Studio Figma guides |
| API reference read | Referenced primitive API tables, behavior, keyboard/focus contracts | Radix Checkbox, Dialog and Direction Provider; upstream Markdown extraction loses some embedded JSX examples, so those examples are not claimed as intact source |
| Fetched only | Available for later bounded investigation | Remaining full guides/template bodies/theming details and additional selected-family docs; individual premium block source, most example source, and complete Base/Aria implementations remain unread |

Two URLs were unavailable: the legacy [official v0 URL](https://ui.shadcn.com/docs/v0) and noncanonical Studio `/docs/getting-started/license` returned errors/404. The canonical [Studio licence](https://shadcnstudio.com/license) was accessible and read completely. There was no inaccessible selected-family source substituted with invented code.

The catalog counts refer to publicly indexed **category pages**, not the vendor's advertised individual assets. “1000+ blocks” and “100+ pages” are marketing/entitlement labels and are not counts of individually inspected source implementations. Some public templates/pages expose a gallery or product overview rather than their full downloadable code. No claim of reading every premium asset is made.

## Account, Figma and licence evidence

The existing Chrome Studio account was already signed in. Its Purchases page showed enabled Blocks, Illustrations, Pages, landing/full templates, dashboard/app templates, Figma UIKit, UIKit+Blocks, UIKit+Templates, Figma plugin, Builder/Page presets, MCP and IDE-extension access. Account emails and licence-key values were neither recorded here nor copied into configuration. Studio public access, paid entitlement, downloadable source inspection, and configured BYOK generation are distinct facts: entitlement is verified; premium component download/authenticated registry generation has not been exercised.

The working Figma connector account reported one accessible team on the Starter plan, a View seat and admin role. The separate Primary connector requires reauthentication. Original licensed UIKit/Blocks files could be viewed in Chrome; MCP editing/metadata of those source files was rejected. A normal Figma “Duplicate to drafts” operation created an editable private copy; original files were not changed.

| Resource | Verified link / status |
| --- | --- |
| Studio UIKit source | [Nova UIKit v1.1](https://www.figma.com/design/2rdvFqLR3yCpjAar0A89Hu/shadcn-studio-nova-uikit-v1.1) — browser view; source MCP edit access rejected |
| Studio UIKit + Blocks source | [Nova UIKit + Blocks v2](https://www.figma.com/design/zEouzMU77lDI9SwbkZC4EZ/shadcn-studio-nova-uikit-blocks-v2) — entitlement link verified; no whole-file implementation claim |
| Studio UIKit + Templates source | [UIKit + Templates v1.1](https://www.figma.com/design/7byWS3NHcsrG9mWpW5n9H9/shadcn-studio-nova-uikit-templates-v1.1) — entitlement link verified |
| Studio plugin | [Figma to shadcn/ui](https://www.figma.com/community/plugin/1540602627375556818) — entitlement verified; no provider/API key configuration performed |
| Editable isolated licensed copy | [Infame research copy](https://www.figma.com/design/oR5Z7suB4fJ7B40KLDk7Ol) — copied kit with local source components/variables |
| New Infame draft | [Infame · إنفيم · MVP handoff](https://www.figma.com/design/45Fzr1m0v4EgPUpm3pYBoG) — created successfully; screen composition status is recorded in UI_COMPOSITION.md |

The private copy has about 80 inherited pages and four existing variable collections: semantic Light/Dark Mode (137 variables), Tailwind primitives (494), responsive Web/Tablet/Mobile (11), and Themes (327). Component discovery read actual local Button, Input, Card, Checkbox and Textarea variants/properties. `get_libraries` returned unrelated available community libraries, none a published Studio library; required design-system searches for the identified Solid Button/background/body assets returned empty. The server clamped the initial multi-query search to one; the two unprocessed searches were then called separately. Empty connector search results do not mean the copied local kit lacks components; local Plugin API discovery found them.

Starter limitations are real: adding a new page to the copied kit was rejected, and the MCP tool quota was reached before MCP screen composition. Two Infame collections and 21 colour variables were created successfully; their exact IDs are in the ignored `.research/figma-state.json`. Browser fallback subsequently created one limited [English layout study](https://www.figma.com/design/45Fzr1m0v4EgPUpm3pYBoG?node-id=1-907): a 360 × 800 vertical auto-layout frame with two actual licensed Studio Button instances, 48 px action height, IBM Plex Sans Latin and Infame light colours. This is partial composition evidence, not the complete requested screen set or accepted onboarding design. IBM Plex Sans Latin is available in the connected Figma font list; **IBM Plex Sans Arabic is absent**, including the browser font search. Noto Sans Arabic is available but is not the accepted final product font. Typography and Figma screen acceptance remain open. No seat/plan upgrade or new access grant was attempted.

The [Studio licence](https://shadcnstudio.com/license), updated 2026-01-13, permits commercial/client end products and application customization under the purchased licence. It prohibits distributing the resource library separately, sharing personal-licence access, and competing UI kits/builders/starter products. Team coverage is up to **15** employed/contracted individuals; the exact purchased tier was not inferred from an “all access” label. The free licence page calls its resources MIT while also stating Commons Clause resale/competition restrictions: do not treat that page as unrestricted MIT distribution. Official [shadcn/ui repository licence](https://github.com/shadcn-ui/ui/blob/main/LICENSE.md) is a separate licence. Keep licensed original kits, premium source archives, cache mirrors and authentication configuration private; ship customized Infame end-product components rather than a standalone vendor mirror.

## Registry and CLI findings

After the root completed the inherited npm baseline, read-only `npx shadcn@4.21.1` commands were exercised:

- `info`: Next.js 16.3.8, Tailwind 4, src directory, TypeScript, RSC, `@/` alias; initially no `components.json` or installed shadcn components.
- `search '@shadcn' --limit 100 --offset 0/100/200/300/400 --json`: complete 471-item registry listing, offsets 100/100/100/100/71.
- `docs ... --base radix --json`: selected Radix docs and referenced API/source links.
- `view https://ui.shadcn.com/r/styles/radix-nova/{name}.json`: exact Button/Card/Checkbox/Dialog/Sheet sources inspected.
- `docs drawer`: default CLI documentation now points at the **Base UI** Drawer API. The current catalog is not a safe assumption of the older Vaul-based Drawer.
- Help for `search`, `view`, `docs` and `add` read. `view --style` is unsupported; use explicit registry URLs or initialized style configuration. `add` exposes dry-run/diff/view flags, which should be used before repository mutation.

Windows registry searches wrote valid JSON but exited with a Node/libuv `UV_HANDLE_CLOSING` assertion. All five pagination records and item counts were inspected; this is recorded as a CLI execution anomaly, not a clean command pass. The successful source-view/docs calls did not reproduce it. No CLI `init` or `add` ran in this design assignment.

The official registry listing contains 61 UI items, 97 blocks, 239 examples, 52 fonts, 13 internal items, 5 themes, 2 styles, 1 library and 1 hook. These are registry entries, not distinct application requirements. Registry names were all indexed; individual example implementations were not all read.

[Studio CLI](https://shadcnstudio.com/docs/getting-started/how-to-use-shadcn-cli) documentation exposes `@shadcn-studio`, `@ss-components`, `@ss-blocks`, `@ss-pages`, `@ss-illustrations`, and `@ss-themes` namespace patterns. Premium access uses email/licence-key registry authentication placeholders. Never put credential values in tracked `components.json`, logs, screenshots or this report. A configured namespace is not evidence that a particular premium source was read.

## Central primitive recommendation

Use one **Radix** family for the initial Infame controls. Centralize the root-owned components; page workers consume those wrappers. Studio supplies composition/layout inspiration and the licensed Figma kit; its copied layout does not establish authorization, voice behavior, matching logic or agreement lifecycle.

| Primitive / full selected evidence | Contract and Infame adaptation |
| --- | --- |
| [Button](https://ui.shadcn.com/docs/components/radix/button) | Native button plus Radix Slot `asChild`; CVA variants default/outline/ghost/destructive/secondary/link. Explicit button `type`; links remain links. Icon buttons have localized names. Default 32 px / lg 36 px are too small for Infame mobile: wrap/override to 44 px minimum, preferred 48 px primary actions. Real pending disables duplicate submit and preserves readable label. |
| [Card](https://ui.shadcn.com/docs/components/radix/card) | Root `size=default|sm`, header/title/description/action/content/footer. `--card-spacing` controls insets. Do not make whole card a button if it includes nested actions. CardAction's physical top-right description requires RTL placement review. Use card border/surface tokens and evidence dates, not made-up charts. |
| [Input](https://ui.shadcn.com/docs/components/radix/input) | Native input props, required/disabled/`aria-invalid`; associated persistent labels and `aria-describedby` errors. URL/email/handle/amount isolates LTR locally while Arabic prose stays RTL. 16 px mobile input text; browser autocomplete and inputmode appropriate to field. Source-only cosmetic styling provides no validation or authorization. |
| [Textarea](https://ui.shadcn.com/docs/components/radix/textarea) | Native textarea, rows/required/invalid/disabled. Campaign text and transcript fallback retain drafts. No placeholder-only labels. Composer grows until a bounded viewport height, then scrolls internally. |
| [Checkbox](https://ui.shadcn.com/docs/components/radix/checkbox) | Radix checked/unchecked/indeterminate, controlled or uncontrolled, indicator/disabled/required/name/value. Checked callback can return `indeterminate`; consent must require exactly true. Wrap visible box + label in a 44 px target. Separate import permission, account confirmation, ownership proof and publication permission. Do not auto-check consent from restored facts. |
| [Dialog](https://ui.shadcn.com/docs/components/radix/dialog) | Controlled open/onOpenChange, modal focus containment, portal, title/description, Escape and return-to-trigger. Use for deliberate proof/publication/destructive confirmations, not every onboarding sentence. Localize close button, preserve visible cancel/escape, scroll long content. Async failure stays open with retained input. |
| [Sheet](https://ui.shadcn.com/docs/components/radix/sheet) | Built on the same Radix Dialog primitive. Physical side top/right/bottom/left; implement logical inline-start/end mapping from current direction. Mobile filters or deliberate expanded input may use bottom; ordinary bottom onboarding card stays inline/nonmodal. Localize close and explicitly apply `dir` to portals. |
| [Direction](https://ui.shadcn.com/docs/components/radix/direction) | Set both document `dir` and Radix DirectionProvider; change synchronously with locale without discarding form/campaign/draft state. Sheet, dropdown, tooltip, select and dialog portals must inherit the active direction. |

Complete Radix basis source also read for Field and Input Group to understand accessible label/error and composer composition. Their larger full example catalogs are fetched but not claimed fully read; do that before adopting examples verbatim. Field is a semantic composition helper rather than a substitute for server validation. It exposes grouped labels/legend/descriptions/error and horizontal/vertical/responsive layouts; error-list physical `ml-4` must become logical spacing. Input Group's addons use inline-start/end and block-start/end; avoid keyboard submit controls getting obscured by addons.

**Current dependency migration:** the [official September 2026 changelog](https://ui.shadcn.com/docs/changelog) confirms that bare `cn` imports are intentional: new components install the `cn` package, and the utils item re-exports it. The root's reviewed CLI dry-run corroborated this. Use the reviewed `cn` 0.4.0 dependency for new generated primitives; older project helpers remain valid and do not justify an unrequested wholesale migration.

**Raw registry transformation boundary:** styled source still contains internal `IconPlaceholder`, `@/app/(create)/...`, `@/registry/radix-nova/ui/...` and `cn-font-heading`. Registry `dependencies: ['cn']` is not the complete runtime dependency set for adding components to a repository without the original initialization preset. Review the actual transformed CLI output in an isolated dry-run/diff, replace placeholders with the chosen Lucide icons, rewrite component imports to root wrappers, and explicitly review `class-variance-authority`, aggregate `radix-ui`, `lucide-react` and animation CSS when used. The root owns installation and resolved package versions. Do not mix the Base Drawer or React Aria contracts into Radix wrappers.

No new dependency is justified by a Figma appearance alone. Native selects/date inputs can cover baseline country/currency/timezone and date controls. TanStack Table, Recharts, Embla, cmdk, resizable panels, phone-input packages and motion libraries are deferred until a real screen requires their behavior and selected sources/APIs/dependency cost are read.

## RTL, theme and implementation decisions

The [official RTL guide](https://ui.shadcn.com/docs/rtl) and Next/start/Vite subguides were read completely. Current `base-nova` and `radix-nova` can use `rtl: true` and logical-class transforms. Existing older styles need manual migration; Infame must not be rescaffolded just to enable RTL. Official notes require manual review of Calendar, Pagination and Sidebar and mention logical animation limitations in `tw-animate-css`. Check supported directional icons individually; only arrows/chevrons that communicate direction mirror, while logos/media/play/sound icons retain meaning.

Apply `ms/me/ps/pe/start/end`, `text-start`, logical grid placement and DOM order. Do not reverse arrays or keyboard order just to mirror visuals. Handles, email, URLs, licence/CR identifiers, monetary numbers and mixed script data use `dir=ltr`/`bdi` locally. Test actual switch with dialogs open and focus preserved; portals are a common failure point. Locale is separate from campaign country, currency and timezone.

The handoff's IBM Plex fonts and Infame ink/warm-white/yellow/gradient palette override all kit/theme defaults. Dark mode is a complete semantic system, not an inverted screenshot. Yellow uses dark ink foreground; decorative gold #B88A00 must not become normal text on warm white. Gradient is limited to campaign/creator accents; operational evidence and status text use readable solid colours. Do not reuse Studio example payment language, fabricated statistics, proof logos, testimonials or ratings in Infame.

## Composition choices from the full overview pass

| Infame need | Catalog families studied | Choice / boundary |
| --- | --- | --- |
| Public landing, audience pages | Hero, features, CTA, compare, FAQ, navbar/footer, Bento | Compose one real creator/brand proposition, original Arabic copy and two entry journeys. Avoid dashboard hero screenshot, fake logos or testimonials. |
| Creator/company portfolio | Portfolio, gallery, avatar, badge, cards, tabs, empty state | Editable real bio/links/services, explicit evidence and unknowns; gallery only approved uploaded work. Company “private draft” and opt-in publish remain distinct. |
| Onboarding | Multi-step form, onboarding feed, form layout, dialog/sheet, input family | Reuse spacing/surface/input ideas; domain state machine controls one-context card, resume and text/voice parity. Generic five-step demo is not the creator journey. |
| Voice and campaign chat | Studio AI chat bubble; official Bubble/Message/Message Scroller/Questionnaire/Marker/Attachment | New families indexed/overview read, not automatically installed. Domain-driven transcript/composer can reuse native semantic containers; full new-family source is deferred. Questionnaire does not impose its demo cap on onboarding. |
| Campaign brief/matches | Forms, statistics, product-list/filter, application shell | Real editable brief version and explainable confidence/evidence cards. No storefront checkout/cart/payment components; a deal basket only collects requested services and exact money. |
| Deals | Timeline, cards, file upload, dialog, inbox | Versioned offer/counter/acceptance/agreement timeline; document evidence self-reports clearly. No fake invoice settlement or automatic payment processing. |
| Admin | Dashboard shell/sidebar, data table, empty state, file upload, chart/widgets | Role-separated navigation and real counts/queues. CSV preview/errors/idempotency before import. Native table first; graph only real aggregate data. |
| Auth, recovery, claims | Login/register, forgot/reset password, verify email, error, invitation UI | Reuse layout while preserving server auth/proof/expiry semantics. A marketing two-factor block is not a security implementation. |
| Account/PWA/settings | Account settings, form layout, empty/error, Sheet/Alert | Locale/theme/accessibility, export/delete data, consent and proof statuses, notification preferences, install/offline/reconnect. |

Public component and block category inventories follow. They enumerate all indexed Studio families, including unrelated families consciously deferred. Full category markup/source is not reproduced.

## Complete public Studio component family index (57)

All 57 overview introductions and visible variant summaries were read. Individual variant implementation source is a separate evidence level.

- [accordion](https://shadcnstudio.com/docs/components/accordion)
- [alert](https://shadcnstudio.com/docs/components/alert)
- [aspect-ratio](https://shadcnstudio.com/docs/components/aspect-ratio)
- [autocomplete](https://shadcnstudio.com/docs/components/autocomplete)
- [avatar](https://shadcnstudio.com/docs/components/avatar)
- [badge](https://shadcnstudio.com/docs/components/badge)
- [breadcrumb](https://shadcnstudio.com/docs/components/breadcrumb)
- [button](https://shadcnstudio.com/docs/components/button)
- [button-group](https://shadcnstudio.com/docs/components/button-group)
- [calendar](https://shadcnstudio.com/docs/components/calendar)
- [card](https://shadcnstudio.com/docs/components/card)
- [carousel](https://shadcnstudio.com/docs/components/carousel)
- [checkbox](https://shadcnstudio.com/docs/components/checkbox)
- [code-block](https://shadcnstudio.com/docs/components/code-block)
- [collapsible](https://shadcnstudio.com/docs/components/collapsible)
- [combobox](https://shadcnstudio.com/docs/components/combobox)
- [command](https://shadcnstudio.com/docs/components/command)
- [context-menu](https://shadcnstudio.com/docs/components/context-menu)
- [data-table](https://shadcnstudio.com/docs/components/data-table)
- [date-picker](https://shadcnstudio.com/docs/components/date-picker)
- [dialog](https://shadcnstudio.com/docs/components/dialog)
- [drawer](https://shadcnstudio.com/docs/components/drawer)
- [dropdown-menu](https://shadcnstudio.com/docs/components/dropdown-menu)
- [form](https://shadcnstudio.com/docs/components/form)
- [input](https://shadcnstudio.com/docs/components/input)
- [input-mask](https://shadcnstudio.com/docs/components/input-mask)
- [input-otp](https://shadcnstudio.com/docs/components/input-otp)
- [kbd](https://shadcnstudio.com/docs/components/kbd)
- [label](https://shadcnstudio.com/docs/components/label)
- [list](https://shadcnstudio.com/docs/components/list)
- [menubar](https://shadcnstudio.com/docs/components/menubar)
- [navigation-menu](https://shadcnstudio.com/docs/components/navigation-menu)
- [pagination](https://shadcnstudio.com/docs/components/pagination)
- [phone-input](https://shadcnstudio.com/docs/components/phone-input)
- [popover](https://shadcnstudio.com/docs/components/popover)
- [progress](https://shadcnstudio.com/docs/components/progress)
- [radio-group](https://shadcnstudio.com/docs/components/radio-group)
- [rating](https://shadcnstudio.com/docs/components/rating)
- [resizable](https://shadcnstudio.com/docs/components/resizable)
- [scroll-area](https://shadcnstudio.com/docs/components/scroll-area)
- [select](https://shadcnstudio.com/docs/components/select)
- [separator](https://shadcnstudio.com/docs/components/separator)
- [sheet](https://shadcnstudio.com/docs/components/sheet)
- [skeleton](https://shadcnstudio.com/docs/components/skeleton)
- [slider](https://shadcnstudio.com/docs/components/slider)
- [sonner](https://shadcnstudio.com/docs/components/sonner)
- [sortable](https://shadcnstudio.com/docs/components/sortable)
- [spinner](https://shadcnstudio.com/docs/components/spinner)
- [stepper](https://shadcnstudio.com/docs/components/stepper)
- [switch](https://shadcnstudio.com/docs/components/switch)
- [table](https://shadcnstudio.com/docs/components/table)
- [tabs](https://shadcnstudio.com/docs/components/tabs)
- [textarea](https://shadcnstudio.com/docs/components/textarea)
- [toggle](https://shadcnstudio.com/docs/components/toggle)
- [toggle-group](https://shadcnstudio.com/docs/components/toggle-group)
- [tooltip](https://shadcnstudio.com/docs/components/tooltip)
- [typography](https://shadcnstudio.com/docs/components/typography)

## Official component-family indexes

The published canonical plus Base/Radix/React Aria routes resolve to 65 distinct family names, with 251 family routes indexed. All 192 Base/Aria/Radix introductions were read; canonical overview entries were also inspected. Family presence does not imply identical prop contracts or dependencies.

### base (64)

[accordion](https://ui.shadcn.com/docs/components/base/accordion), [alert](https://ui.shadcn.com/docs/components/base/alert), [alert-dialog](https://ui.shadcn.com/docs/components/base/alert-dialog), [aspect-ratio](https://ui.shadcn.com/docs/components/base/aspect-ratio), [attachment](https://ui.shadcn.com/docs/components/base/attachment), [avatar](https://ui.shadcn.com/docs/components/base/avatar), [badge](https://ui.shadcn.com/docs/components/base/badge), [breadcrumb](https://ui.shadcn.com/docs/components/base/breadcrumb), [bubble](https://ui.shadcn.com/docs/components/base/bubble), [button](https://ui.shadcn.com/docs/components/base/button), [button-group](https://ui.shadcn.com/docs/components/base/button-group), [calendar](https://ui.shadcn.com/docs/components/base/calendar), [card](https://ui.shadcn.com/docs/components/base/card), [carousel](https://ui.shadcn.com/docs/components/base/carousel), [chart](https://ui.shadcn.com/docs/components/base/chart), [checkbox](https://ui.shadcn.com/docs/components/base/checkbox), [collapsible](https://ui.shadcn.com/docs/components/base/collapsible), [combobox](https://ui.shadcn.com/docs/components/base/combobox), [command](https://ui.shadcn.com/docs/components/base/command), [context-menu](https://ui.shadcn.com/docs/components/base/context-menu), [data-table](https://ui.shadcn.com/docs/components/base/data-table), [date-picker](https://ui.shadcn.com/docs/components/base/date-picker), [dialog](https://ui.shadcn.com/docs/components/base/dialog), [direction](https://ui.shadcn.com/docs/components/base/direction), [drawer](https://ui.shadcn.com/docs/components/base/drawer), [dropdown-menu](https://ui.shadcn.com/docs/components/base/dropdown-menu), [empty](https://ui.shadcn.com/docs/components/base/empty), [field](https://ui.shadcn.com/docs/components/base/field), [hover-card](https://ui.shadcn.com/docs/components/base/hover-card), [input](https://ui.shadcn.com/docs/components/base/input), [input-group](https://ui.shadcn.com/docs/components/base/input-group), [input-otp](https://ui.shadcn.com/docs/components/base/input-otp), [item](https://ui.shadcn.com/docs/components/base/item), [kbd](https://ui.shadcn.com/docs/components/base/kbd), [label](https://ui.shadcn.com/docs/components/base/label), [marker](https://ui.shadcn.com/docs/components/base/marker), [menubar](https://ui.shadcn.com/docs/components/base/menubar), [message](https://ui.shadcn.com/docs/components/base/message), [message-scroller](https://ui.shadcn.com/docs/components/base/message-scroller), [native-select](https://ui.shadcn.com/docs/components/base/native-select), [navigation-menu](https://ui.shadcn.com/docs/components/base/navigation-menu), [pagination](https://ui.shadcn.com/docs/components/base/pagination), [popover](https://ui.shadcn.com/docs/components/base/popover), [progress](https://ui.shadcn.com/docs/components/base/progress), [questionnaire](https://ui.shadcn.com/docs/components/base/questionnaire), [radio-group](https://ui.shadcn.com/docs/components/base/radio-group), [resizable](https://ui.shadcn.com/docs/components/base/resizable), [scroll-area](https://ui.shadcn.com/docs/components/base/scroll-area), [select](https://ui.shadcn.com/docs/components/base/select), [separator](https://ui.shadcn.com/docs/components/base/separator), [sheet](https://ui.shadcn.com/docs/components/base/sheet), [sidebar](https://ui.shadcn.com/docs/components/base/sidebar), [skeleton](https://ui.shadcn.com/docs/components/base/skeleton), [slider](https://ui.shadcn.com/docs/components/base/slider), [spinner](https://ui.shadcn.com/docs/components/base/spinner), [switch](https://ui.shadcn.com/docs/components/base/switch), [table](https://ui.shadcn.com/docs/components/base/table), [tabs](https://ui.shadcn.com/docs/components/base/tabs), [textarea](https://ui.shadcn.com/docs/components/base/textarea), [toast](https://ui.shadcn.com/docs/components/base/toast), [toggle](https://ui.shadcn.com/docs/components/base/toggle), [toggle-group](https://ui.shadcn.com/docs/components/base/toggle-group), [tooltip](https://ui.shadcn.com/docs/components/base/tooltip), [typography](https://ui.shadcn.com/docs/components/base/typography).

### radix (65)

[accordion](https://ui.shadcn.com/docs/components/radix/accordion), [alert](https://ui.shadcn.com/docs/components/radix/alert), [alert-dialog](https://ui.shadcn.com/docs/components/radix/alert-dialog), [aspect-ratio](https://ui.shadcn.com/docs/components/radix/aspect-ratio), [attachment](https://ui.shadcn.com/docs/components/radix/attachment), [avatar](https://ui.shadcn.com/docs/components/radix/avatar), [badge](https://ui.shadcn.com/docs/components/radix/badge), [breadcrumb](https://ui.shadcn.com/docs/components/radix/breadcrumb), [bubble](https://ui.shadcn.com/docs/components/radix/bubble), [button](https://ui.shadcn.com/docs/components/radix/button), [button-group](https://ui.shadcn.com/docs/components/radix/button-group), [calendar](https://ui.shadcn.com/docs/components/radix/calendar), [card](https://ui.shadcn.com/docs/components/radix/card), [carousel](https://ui.shadcn.com/docs/components/radix/carousel), [chart](https://ui.shadcn.com/docs/components/radix/chart), [checkbox](https://ui.shadcn.com/docs/components/radix/checkbox), [collapsible](https://ui.shadcn.com/docs/components/radix/collapsible), [combobox](https://ui.shadcn.com/docs/components/radix/combobox), [command](https://ui.shadcn.com/docs/components/radix/command), [context-menu](https://ui.shadcn.com/docs/components/radix/context-menu), [data-table](https://ui.shadcn.com/docs/components/radix/data-table), [date-picker](https://ui.shadcn.com/docs/components/radix/date-picker), [dialog](https://ui.shadcn.com/docs/components/radix/dialog), [direction](https://ui.shadcn.com/docs/components/radix/direction), [drawer](https://ui.shadcn.com/docs/components/radix/drawer), [dropdown-menu](https://ui.shadcn.com/docs/components/radix/dropdown-menu), [empty](https://ui.shadcn.com/docs/components/radix/empty), [field](https://ui.shadcn.com/docs/components/radix/field), [hover-card](https://ui.shadcn.com/docs/components/radix/hover-card), [input](https://ui.shadcn.com/docs/components/radix/input), [input-group](https://ui.shadcn.com/docs/components/radix/input-group), [input-otp](https://ui.shadcn.com/docs/components/radix/input-otp), [item](https://ui.shadcn.com/docs/components/radix/item), [kbd](https://ui.shadcn.com/docs/components/radix/kbd), [label](https://ui.shadcn.com/docs/components/radix/label), [marker](https://ui.shadcn.com/docs/components/radix/marker), [menubar](https://ui.shadcn.com/docs/components/radix/menubar), [message](https://ui.shadcn.com/docs/components/radix/message), [message-scroller](https://ui.shadcn.com/docs/components/radix/message-scroller), [native-select](https://ui.shadcn.com/docs/components/radix/native-select), [navigation-menu](https://ui.shadcn.com/docs/components/radix/navigation-menu), [pagination](https://ui.shadcn.com/docs/components/radix/pagination), [popover](https://ui.shadcn.com/docs/components/radix/popover), [progress](https://ui.shadcn.com/docs/components/radix/progress), [questionnaire](https://ui.shadcn.com/docs/components/radix/questionnaire), [radio-group](https://ui.shadcn.com/docs/components/radix/radio-group), [resizable](https://ui.shadcn.com/docs/components/radix/resizable), [scroll-area](https://ui.shadcn.com/docs/components/radix/scroll-area), [select](https://ui.shadcn.com/docs/components/radix/select), [separator](https://ui.shadcn.com/docs/components/radix/separator), [sheet](https://ui.shadcn.com/docs/components/radix/sheet), [sidebar](https://ui.shadcn.com/docs/components/radix/sidebar), [skeleton](https://ui.shadcn.com/docs/components/radix/skeleton), [slider](https://ui.shadcn.com/docs/components/radix/slider), [sonner](https://ui.shadcn.com/docs/components/radix/sonner), [spinner](https://ui.shadcn.com/docs/components/radix/spinner), [switch](https://ui.shadcn.com/docs/components/radix/switch), [table](https://ui.shadcn.com/docs/components/radix/table), [tabs](https://ui.shadcn.com/docs/components/radix/tabs), [textarea](https://ui.shadcn.com/docs/components/radix/textarea), [toast](https://ui.shadcn.com/docs/components/radix/toast), [toggle](https://ui.shadcn.com/docs/components/radix/toggle), [toggle-group](https://ui.shadcn.com/docs/components/radix/toggle-group), [tooltip](https://ui.shadcn.com/docs/components/radix/tooltip), [typography](https://ui.shadcn.com/docs/components/radix/typography).

### aria (63)

[accordion](https://ui.shadcn.com/docs/components/aria/accordion), [alert](https://ui.shadcn.com/docs/components/aria/alert), [alert-dialog](https://ui.shadcn.com/docs/components/aria/alert-dialog), [aspect-ratio](https://ui.shadcn.com/docs/components/aria/aspect-ratio), [attachment](https://ui.shadcn.com/docs/components/aria/attachment), [avatar](https://ui.shadcn.com/docs/components/aria/avatar), [badge](https://ui.shadcn.com/docs/components/aria/badge), [breadcrumb](https://ui.shadcn.com/docs/components/aria/breadcrumb), [bubble](https://ui.shadcn.com/docs/components/aria/bubble), [button](https://ui.shadcn.com/docs/components/aria/button), [button-group](https://ui.shadcn.com/docs/components/aria/button-group), [calendar](https://ui.shadcn.com/docs/components/aria/calendar), [card](https://ui.shadcn.com/docs/components/aria/card), [carousel](https://ui.shadcn.com/docs/components/aria/carousel), [chart](https://ui.shadcn.com/docs/components/aria/chart), [checkbox](https://ui.shadcn.com/docs/components/aria/checkbox), [collapsible](https://ui.shadcn.com/docs/components/aria/collapsible), [combobox](https://ui.shadcn.com/docs/components/aria/combobox), [command](https://ui.shadcn.com/docs/components/aria/command), [context-menu](https://ui.shadcn.com/docs/components/aria/context-menu), [data-table](https://ui.shadcn.com/docs/components/aria/data-table), [date-picker](https://ui.shadcn.com/docs/components/aria/date-picker), [dialog](https://ui.shadcn.com/docs/components/aria/dialog), [direction](https://ui.shadcn.com/docs/components/aria/direction), [drawer](https://ui.shadcn.com/docs/components/aria/drawer), [dropdown-menu](https://ui.shadcn.com/docs/components/aria/dropdown-menu), [empty](https://ui.shadcn.com/docs/components/aria/empty), [field](https://ui.shadcn.com/docs/components/aria/field), [hover-card](https://ui.shadcn.com/docs/components/aria/hover-card), [input](https://ui.shadcn.com/docs/components/aria/input), [input-group](https://ui.shadcn.com/docs/components/aria/input-group), [input-otp](https://ui.shadcn.com/docs/components/aria/input-otp), [item](https://ui.shadcn.com/docs/components/aria/item), [kbd](https://ui.shadcn.com/docs/components/aria/kbd), [label](https://ui.shadcn.com/docs/components/aria/label), [marker](https://ui.shadcn.com/docs/components/aria/marker), [message](https://ui.shadcn.com/docs/components/aria/message), [message-scroller](https://ui.shadcn.com/docs/components/aria/message-scroller), [native-select](https://ui.shadcn.com/docs/components/aria/native-select), [pagination](https://ui.shadcn.com/docs/components/aria/pagination), [popover](https://ui.shadcn.com/docs/components/aria/popover), [progress](https://ui.shadcn.com/docs/components/aria/progress), [questionnaire](https://ui.shadcn.com/docs/components/aria/questionnaire), [radio-group](https://ui.shadcn.com/docs/components/aria/radio-group), [resizable](https://ui.shadcn.com/docs/components/aria/resizable), [scroll-area](https://ui.shadcn.com/docs/components/aria/scroll-area), [select](https://ui.shadcn.com/docs/components/aria/select), [separator](https://ui.shadcn.com/docs/components/aria/separator), [sheet](https://ui.shadcn.com/docs/components/aria/sheet), [sidebar](https://ui.shadcn.com/docs/components/aria/sidebar), [skeleton](https://ui.shadcn.com/docs/components/aria/skeleton), [slider](https://ui.shadcn.com/docs/components/aria/slider), [sonner](https://ui.shadcn.com/docs/components/aria/sonner), [spinner](https://ui.shadcn.com/docs/components/aria/spinner), [switch](https://ui.shadcn.com/docs/components/aria/switch), [table](https://ui.shadcn.com/docs/components/aria/table), [tabs](https://ui.shadcn.com/docs/components/aria/tabs), [textarea](https://ui.shadcn.com/docs/components/aria/textarea), [toast](https://ui.shadcn.com/docs/components/aria/toast), [toggle](https://ui.shadcn.com/docs/components/aria/toggle), [toggle-group](https://ui.shadcn.com/docs/components/aria/toggle-group), [tooltip](https://ui.shadcn.com/docs/components/aria/tooltip), [typography](https://ui.shadcn.com/docs/components/aria/typography).


## Complete Studio block category index (71)

Every category below was fetched and its purpose/visible variant summary read. Individual premium variants and previews are not all source-read.

### bento-grid

- [bento-grid](https://shadcnstudio.com/blocks/bento-grid/bento-grid)
### dashboard-and-application

- [account-settings](https://shadcnstudio.com/blocks/dashboard-and-application/account-settings)
- [application-block](https://shadcnstudio.com/blocks/dashboard-and-application/application-block)
- [application-shell](https://shadcnstudio.com/blocks/dashboard-and-application/application-shell)
- [card-nav](https://shadcnstudio.com/blocks/dashboard-and-application/card-nav)
- [charts-component](https://shadcnstudio.com/blocks/dashboard-and-application/charts-component)
- [dashboard-dialog](https://shadcnstudio.com/blocks/dashboard-and-application/dashboard-dialog)
- [dashboard-dropdown](https://shadcnstudio.com/blocks/dashboard-and-application/dashboard-dropdown)
- [dashboard-footer](https://shadcnstudio.com/blocks/dashboard-and-application/dashboard-footer)
- [dashboard-header](https://shadcnstudio.com/blocks/dashboard-and-application/dashboard-header)
- [dashboard-shell](https://shadcnstudio.com/blocks/dashboard-and-application/dashboard-shell)
- [dashboard-sidebar](https://shadcnstudio.com/blocks/dashboard-and-application/dashboard-sidebar)
- [empty-state](https://shadcnstudio.com/blocks/dashboard-and-application/empty-state)
- [event-calendar](https://shadcnstudio.com/blocks/dashboard-and-application/event-calendar)
- [file-upload](https://shadcnstudio.com/blocks/dashboard-and-application/file-upload)
- [form-layout](https://shadcnstudio.com/blocks/dashboard-and-application/form-layout)
- [gantt-chart](https://shadcnstudio.com/blocks/dashboard-and-application/gantt-chart)
- [inbox-app](https://shadcnstudio.com/blocks/dashboard-and-application/inbox-app)
- [kanban-app](https://shadcnstudio.com/blocks/dashboard-and-application/kanban-app)
- [map-blocks](https://shadcnstudio.com/blocks/dashboard-and-application/map-blocks)
- [multi-step-form](https://shadcnstudio.com/blocks/dashboard-and-application/multi-step-form)
- [multi-view](https://shadcnstudio.com/blocks/dashboard-and-application/multi-view)
- [onboarding-feed](https://shadcnstudio.com/blocks/dashboard-and-application/onboarding-feed)
- [statistics-component](https://shadcnstudio.com/blocks/dashboard-and-application/statistics-component)
- [widgets-component](https://shadcnstudio.com/blocks/dashboard-and-application/widgets-component)
- [workflow-builder](https://shadcnstudio.com/blocks/dashboard-and-application/workflow-builder)
### datatable

- [datatable-component](https://shadcnstudio.com/blocks/datatable/datatable-component)
### ecommerce

- [announcement-banner](https://shadcnstudio.com/blocks/ecommerce/announcement-banner)
- [category-filter](https://shadcnstudio.com/blocks/ecommerce/category-filter)
- [checkout-page](https://shadcnstudio.com/blocks/ecommerce/checkout-page)
- [gift-card](https://shadcnstudio.com/blocks/ecommerce/gift-card)
- [mega-footer](https://shadcnstudio.com/blocks/ecommerce/mega-footer)
- [offer-modal](https://shadcnstudio.com/blocks/ecommerce/offer-modal)
- [order-summary](https://shadcnstudio.com/blocks/ecommerce/order-summary)
- [product-category](https://shadcnstudio.com/blocks/ecommerce/product-category)
- [product-list](https://shadcnstudio.com/blocks/ecommerce/product-list)
- [product-overview](https://shadcnstudio.com/blocks/ecommerce/product-overview)
- [product-quick-view](https://shadcnstudio.com/blocks/ecommerce/product-quick-view)
- [product-reviews](https://shadcnstudio.com/blocks/ecommerce/product-reviews)
- [shopping-cart](https://shadcnstudio.com/blocks/ecommerce/shopping-cart)
### marketing-ui

- [about-us-page](https://shadcnstudio.com/blocks/marketing-ui/about-us-page)
- [ai-chat-bubble-component](https://shadcnstudio.com/blocks/marketing-ui/ai-chat-bubble-component)
- [app-integration](https://shadcnstudio.com/blocks/marketing-ui/app-integration)
- [compare](https://shadcnstudio.com/blocks/marketing-ui/compare)
- [contact-us-page](https://shadcnstudio.com/blocks/marketing-ui/contact-us-page)
- [cookies-consent](https://shadcnstudio.com/blocks/marketing-ui/cookies-consent)
- [cta-section](https://shadcnstudio.com/blocks/marketing-ui/cta-section)
- [download](https://shadcnstudio.com/blocks/marketing-ui/download)
- [error-page](https://shadcnstudio.com/blocks/marketing-ui/error-page)
- [faq-component](https://shadcnstudio.com/blocks/marketing-ui/faq-component)
- [features-section](https://shadcnstudio.com/blocks/marketing-ui/features-section)
- [footer-component](https://shadcnstudio.com/blocks/marketing-ui/footer-component)
- [forgot-password](https://shadcnstudio.com/blocks/marketing-ui/forgot-password)
- [gallery-component](https://shadcnstudio.com/blocks/marketing-ui/gallery-component)
- [hero-section](https://shadcnstudio.com/blocks/marketing-ui/hero-section)
- [login-page](https://shadcnstudio.com/blocks/marketing-ui/login-page)
- [logo-cloud](https://shadcnstudio.com/blocks/marketing-ui/logo-cloud)
- [navbar-component](https://shadcnstudio.com/blocks/marketing-ui/navbar-component)
- [portfolio](https://shadcnstudio.com/blocks/marketing-ui/portfolio)
- [pricing-component](https://shadcnstudio.com/blocks/marketing-ui/pricing-component)
- [register](https://shadcnstudio.com/blocks/marketing-ui/register)
- [reset-password](https://shadcnstudio.com/blocks/marketing-ui/reset-password)
- [social-proof](https://shadcnstudio.com/blocks/marketing-ui/social-proof)
- [team-section](https://shadcnstudio.com/blocks/marketing-ui/team-section)
- [testimonials-component](https://shadcnstudio.com/blocks/marketing-ui/testimonials-component)
- [timeline-component](https://shadcnstudio.com/blocks/marketing-ui/timeline-component)
- [two-factor-authentication](https://shadcnstudio.com/blocks/marketing-ui/two-factor-authentication)
- [user-schedule](https://shadcnstudio.com/blocks/marketing-ui/user-schedule)
- [verify-email](https://shadcnstudio.com/blocks/marketing-ui/verify-email)
- [video-call-component](https://shadcnstudio.com/blocks/marketing-ui/video-call-component)
- [waitlist-component](https://shadcnstudio.com/blocks/marketing-ui/waitlist-component)

## Pages, templates, themes and design resources

All ten Pages category introductions were read: Landing 19, Features 19, Pricing 20, About 6, Blog 7, Contact 10, FAQ 8, Integrations 5, Error 5 and Changelog 2 visibly listed pages (101 total at research time). These are gallery counts, not individually verified source/API counts. The public landing gallery exposes 19 numbered variants. Only landing appeared in the initial sitemap; the other category routes were discovered from actual observed gallery hrefs.

- [Pages gallery](https://shadcnstudio.com/pages)
- [about-page](https://shadcnstudio.com/pages/about-page)
- [blog-page](https://shadcnstudio.com/pages/blog-page)
- [changelog-page](https://shadcnstudio.com/pages/changelog-page)
- [contact-page](https://shadcnstudio.com/pages/contact-page)
- [error-page](https://shadcnstudio.com/pages/error-page)
- [faq-page](https://shadcnstudio.com/pages/faq-page)
- [feature-page](https://shadcnstudio.com/pages/feature-page)
- [integrations-page](https://shadcnstudio.com/pages/integrations-page)
- [landing-page](https://shadcnstudio.com/pages/landing-page)
- [pricing-page](https://shadcnstudio.com/pages/pricing-page)

The 30 template/gallery routes below were overview-read. AdminCN and several application detail pages explicitly state that their template does **not** provide a Figma design file. Do not assume all paid templates have editable Figma counterparts. Craft/Zolt portfolio composition and Flow/Brandly marketing structure are relevant; none replaces Talaqee infrastructure. Payment/investment/POS/inventory behavior from unrelated templates remains out of scope.

- [templates](https://shadcnstudio.com/templates)
- [admin-dashboard](https://shadcnstudio.com/templates/admin-dashboard)
- [admincn](https://shadcnstudio.com/templates/admin-dashboard/admincn)
- [admincn-free](https://shadcnstudio.com/templates/admin-dashboard/admincn-free)
- [aidesk](https://shadcnstudio.com/templates/admin-dashboard/aidesk)
- [calendrix](https://shadcnstudio.com/templates/admin-dashboard/calendrix)
- [cargorix](https://shadcnstudio.com/templates/admin-dashboard/cargorix)
- [commerceo](https://shadcnstudio.com/templates/admin-dashboard/commerceo)
- [finora](https://shadcnstudio.com/templates/admin-dashboard/finora)
- [nexacrm](https://shadcnstudio.com/templates/admin-dashboard/nexacrm)
- [promptly](https://shadcnstudio.com/templates/admin-dashboard/promptly)
- [propxyz](https://shadcnstudio.com/templates/admin-dashboard/propxyz)
- [restropos](https://shadcnstudio.com/templates/admin-dashboard/restropos)
- [sprintrix](https://shadcnstudio.com/templates/admin-dashboard/sprintrix)
- [tourix](https://shadcnstudio.com/templates/admin-dashboard/tourix)
- [bistro-restaurant-template-free](https://shadcnstudio.com/templates/bistro-restaurant-template-free)
- [brandly-agency-template](https://shadcnstudio.com/templates/brandly-agency-template)
- [craft-portfolio-template](https://shadcnstudio.com/templates/craft-portfolio-template)
- [flow-saas-template](https://shadcnstudio.com/templates/flow-saas-template)
- [grow-marketing-template](https://shadcnstudio.com/templates/grow-marketing-template)
- [ink-blog-template-free](https://shadcnstudio.com/templates/ink-blog-template-free)
- [matter-physical-product-template](https://shadcnstudio.com/templates/matter-physical-product-template)
- [neural-ai-app-template](https://shadcnstudio.com/templates/neural-ai-app-template)
- [orion-ai-agent-template](https://shadcnstudio.com/templates/orion-ai-agent-template)
- [pureskin-skin-care-template](https://shadcnstudio.com/templates/pureskin-skin-care-template)
- [shopix-ecommerce-template](https://shadcnstudio.com/templates/shopix-ecommerce-template)
- [skillsphere-lms-template](https://shadcnstudio.com/templates/skillsphere-lms-template)
- [swipe-mobile-app-template](https://shadcnstudio.com/templates/swipe-mobile-app-template)
- [track-changelog-template-free](https://shadcnstudio.com/templates/track-changelog-template-free)
- [zolt-portfolio-template-free](https://shadcnstudio.com/templates/zolt-portfolio-template-free)

Studio publishes a [Theme Generator](https://shadcnstudio.com/theme-generator) and [theme workflow](https://shadcnstudio.com/docs/getting-started/theme-generator), rather than a full standalone public sitemap of every premium/custom theme registry item. Visible preset examples include Default, Claude, Modern Minimal, Marvel, Corporate, Perplexity, Nature and Summer; additional landing examples show Art Deco, Spotify, Neo Brutalism, Marshmallow and Ghibli Studio. This is not a claim to have enumerated private/custom user theme source. The official CLI registry lists five theme entries; their names were indexed. Infame handoff colours/fonts take precedence over these presets.

- [components](https://shadcnstudio.com/docs/documentation-figma/components)
- [design-to-code-workflow](https://shadcnstudio.com/docs/documentation-figma/design-to-code-workflow)
- [figma-slots](https://shadcnstudio.com/docs/documentation-figma/figma-slots)
- [figma-to-code-mcp-server](https://shadcnstudio.com/docs/documentation-figma/figma-to-code-mcp-server)
- [figma-to-shadcn-plugin](https://shadcnstudio.com/docs/documentation-figma/figma-to-shadcn-plugin)
- [getting-started](https://shadcnstudio.com/docs/documentation-figma/getting-started)
- [introduction](https://shadcnstudio.com/docs/documentation-figma/introduction)
- [theming](https://shadcnstudio.com/docs/documentation-figma/theming)
- [updates](https://shadcnstudio.com/docs/documentation-figma/updates)
- [variables](https://shadcnstudio.com/docs/documentation-figma/variables)
- [theme-generator](https://shadcnstudio.com/docs/getting-started/theme-generator)
- [figma](https://shadcnstudio.com/figma)
- [figma-plugin](https://shadcnstudio.com/figma-plugin)
- [theme-generator](https://shadcnstudio.com/theme-generator)

All ten Figma documentation introductions and purposes above were read, followed by their complete cached visible guide bodies. Collapsed FAQ answers or inactive method tabs absent from the extraction are not claimed read. Components and slots preserve component connections and expose variants, text, booleans and flexible contents; do not flatten kit instances merely to change a screen. Variables organize Mode, Tailwind, responsive and theme collections, with semantic colours aliased rather than changed on each instance. Published kit updates arrive in new files and do not automatically update customized existing copies.

The design-to-code overview distinguishes exact existing block CLI retrieval from generation for customized frames. The plugin offers Radix and Base UI output; Infame chooses Radix explicitly. BYOK generation remains separate from paid entitlement. Plugin-generated code still requires dependency review, real data binding, authorization, accessible state behavior and RTL/mobile testing. No BYOK key was entered and no provider-backed plugin generation was run.

The complete plugin guide confirms that its Create Theme action changes only the existing Themes collection's Default mode; the separate Light/Dark Mode collection and other theme presets are unchanged. It supports CSS-variable import and Tailwind 4 export. Infame requires deliberate semantic binding and paired light/dark review rather than assuming that pressing Apply establishes code/design parity. The copied kit retains its Tailwind primitive scale; brand changes belong in semantic/theme variables. Free-plan duplication is supported, while cross-file library publishing requires a paid Figma plan; no publishing or plan change was attempted.
