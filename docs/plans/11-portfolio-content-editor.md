# M11a full portfolio content editor

Root preparation,2026-10-11. Native APPROVE_PORTFOLIO already accepts full content
and enforces current actor/session/draft/version/generated-source and immutable
approval; no schema/API/provider change needed. Public publication stays separate.

Product paths after native browser RED: new
src/components/infame/portfolio-content-editor.tsx and existing
src/components/infame/onboarding-screen.tsx only (optional leaf CSS if necessary).
Root owns panel/mount/recovery; worker may draft only explicitly assigned tmp
.tsx.draft files. Independent browser author uses actual native sessions/producers.
Preserve other edits, Talaqee Card geometry and shared Infame semantic brand tokens.

Use existing Input/Textarea/Button/fieldset composition for original title (200),
bio (1000), and up to20 ordered sections {heading(100),text(2000)}. Fixed existing
method remains APPROVED_FACT_TEMPLATE.
No links/media/assets/work CRUD/export or claims of AI generation in this slice.
Add/remove and keyboard-operable move up/down controls with stable section keys,
focus retained/restored after edits/reorder/removal and accessible count/status.
Do not trim/translate original bio or section text; central title/heading rules
remain. Approved version is readonly; generate another version to edit. No consent
is inferred and no automatic publication occurs from editing/approval.

Parent owns complete editable content and captures that exact body in the existing
APPROVE_PORTFOLIO request. Recovery/UNKNOWN/pending blocks new writes and edits,
keeps exact captured UUID/body/version and does not reset words on failed/malformed
reads. Native denial clears all protected content/editor state before body parsing.
Explicit current server version change initializes the new editor; harmless locale
changes and same-version readonly refresh preserve local edits. Regeneration of
an existing dirty unapproved editor requires explicit Keep/Discard choice, using
the existing retained dialog pattern. No new navigation/history rewrite here.
Expose portfolio-step readonly refresh using the existing readSnapshot(true)
handler and 'حمّل المسودة الحالية'/'Reload current draft' label; same-version
successful reads preserve local edits, actual denial clears them, and no mutation
is added. This provides a real recovery/access check while the editor is dirty.

Acceptance: two bounded actual browser groups across Arabic360/Englishdesktop:
title/bio/two sections editing/reorder/remove and exact native approval, immutable
approved controls and separate explicit publication; unknown response captures
complete body/key and exact retry, locale/same-version-read preservation, current
denial removal and new-version initialization. Check focus, long text, keyboard,
reduced motion and mobile geometry. Current native backend tests already establish
money/session approval policy; extend only a meaningful full-section immutability/
replay control if browser fixtures reveal a gap. No mock auth/approval/live claims.
Run all four gates and independent source/browser/visual checks before commit.

Compatibility correction: the existing onboarding native-session browser helper
must select its read-only recovery control uniquely when recovery and the new
portfolio refresh coexist. Scope is that helper only; retain every real native
denial, delayed-read, exact replay and assertion. Recovery, error-card read and
ordinary portfolio refresh use mutually exclusive priority branches.
