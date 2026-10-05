# M02C3a — prepare public identity capture for scoped collections

Prerequisite: reviewed `ceae6c48aac37df05ed8b36ec8091b15d808e7dc` with
918 guarded checks, 97 browser checks/one existing duplicate skip and all four
release gates. This is the next bounded assignment, not completed functionality.

Preserve the original Talaqee interface, `/` and `/classic`, current public-only
discovery, exact observation consent, the one-reader budget and all publication
predicates. No schema, client authority, provider, outreach or billing change
belongs to this extraction. The original source remains read-only.

## Contracts and ownership

The coordinator owns this freeze/docs and the initial inert typed capture
contract. The product leaf owns only
`src/lib/discovery/public-identity-capture.ts` and
`src/lib/discovery/public-identity.ts` after independent native RED. The test
author owns only `tests/discovery/identity-capture.test.ts`, initially an ignored
draft. Root alone activates/executes guarded targets. Peers are not alone and
must preserve every other path; reviews are read-only.

Extract three stages without changing the default public loader's semantics:

- `capturePublicCreatorIdentities(tx, ids, now, reader)` selects the same bounded
  creator/account/newest-observation references, captures the clock once and
  returns an internal batch. It takes no User or domain lock and hydrates no
  proof/content/history. This batch is not a DTO or an authorization claim.
- `publicIdentityActors(capture)` derives the same creator-owner mappings and
  separately bounded owner/reviewer sets, removing reviewers already in owners.
  `lockPublicIdentityUsers(tx, capture, reader)` performs the existing sorted
  owner group then reviewer group SHARE locks for the default public wrapper.
- `projectPublicCreatorIdentities(tx, capture, actors, reader)` requires those
  captured actor identities/mappings and takes no User lock. Trusted bridge
  supersets are allowed; no required owner/reviewer/mapping may be omitted.
  It retains Creator→SocialAccount,
  later latest-portfolio/chosen-snapshot locking, all scope rechecks and the
  shared core/proof/consent projection. Latest portfolio selection remains after
  Creator/SocialAccount locks. Preserve exact proof order and no old fallback.

The existing `loadPublicCreatorIdentities` is a thin composition of those stages
with the same required reader, unchanged DTO and deadline/failure behavior.
All stages checkpoint on entry, after native waits and before the next query;
no new reader, deadline reset, late User lock or partial-success fallback.

## Independent native acceptance

Current42 identity witnesses and affected publication/proof tests must remain
green unchanged. New native witnesses compare default versus staged output and
actual selective query order; capture has no User/domain lock or private content
hydration, projection acquires no User lock after supplied actors. Exercise a
scoped private primary, chosen unknown/follower observation and latest portfolio
without overfetch. Drift in owner/account/reviewer/selected observation rejects
without adding a lock; invalid/missing captured actors fail closed. One actual
reader/time budget spans capture/locks/projection and stops after a genuine wait.
Tests use actual disposable DB/evidence fixtures, not live provider acceptance.

Independent source review, appropriate browser regression and `npm run check`
precede commit. Record results in PROGRESS and preserve unrelated research.

## Following bridge and collection freeze

This extraction alone does not fix tenant lock composition or enable private
collections. The coordinator's following bridge must put actor + organization
owner + current Brand owner + selected creator owners in one sorted owner group,
then separately bounded selected reviewers, then actor AuthSession and domain
locks. Native races must exercise that outer boundary against deal/evidence
writers. Never flatten reviewers into generic organization userIds, silently
truncate bounds or call a User-locking loader from a tenant callback.

Subsequent OWN_BRAND and CLIENT scopes are explicit with no permission fallback;
own-company scope cannot expose either agency's records for the same Brand.
Client view/plan remain independent, with minimal plan-only receipts and current
authority before replay. The collection/entry/command/deletion migration needs
its own freeze; preserve notes/history through archive or reviewed tombstones.
Reproject current saved identities, keep unavailable references honest and
separate comparison from campaign matching/procurement. Readiness and remaining
M03–M15 implementation stay in the approved full plan.
