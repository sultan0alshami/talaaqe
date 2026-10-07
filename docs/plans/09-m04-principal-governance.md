# M04B — Infame principal and controlled operational authority

2026-10-07. Read-only source-backed preparation after the customer-request slice.
This does not provision a legal entity, seat, signatory, operator, tax policy,
merchant or live service. Principal/signing readiness stays unavailable until
genuine evidence is provisioned. D048/D068 and the full managed plan govern.

Root owns schema/contracts/auth/env/governance provisioning and native boundary.
Independent authors receive exact bounded failure tests before implementation;
product leaves receive only declared paths afterward. No ordinary ADMIN power,
customer Brand, agency membership or task fixture substitutes for Infame authority.

## Minimal additive records

- InfamePrincipal: stable identity, DRAFT/ACTIVE/PAUSED/REVOKED state/revision,
  current approved version and explicit LIVE/DEVELOPMENT_FIXTURE provenance.
- Immutable InfamePrincipalVersion: original actual legal/trading name, legal
  form, registration authority/identifier/jurisdiction/address, reviewed activities/
  markets and exact managed policy/terms hashes. Customer-safe party snapshot is
  separate from private qualified evidence.
- InfameGovernanceSeat: immutable principal/user, separately explicit review,
  assignment or emergency-revocation purposes, issuer/authorization and subject
  evidence pin, validity/recheck interval, state/revision. ADMIN alone grants none.
- ManagedOperationalGrant: exact principal version/operator/order/workspace/
  campaign/retained submission; independent VIEW/ISSUE/SIGN purpose, grantor/seat
  revision/evidence, valid interval and relevant document/market/amount/currency
  restrictions. No wildcard tenant/client permission.
- ManagedGovernanceCommand: immutable actor/UUID/hash and bounded scalar receipt;
  atomic mutation/metadata audit/outbox without evidence text, tokens/storage keys.

## Genuine readiness and provisioning

Evidence entries bind exact entity/person subject, check kind, source or purpose-
specific private asset/checksum, observation/review date, qualified reviewer/
reference, reviewed policy, covered activities/markets/documents, effective/expiry
or explicit recheck deadline, status and provenance. Registration/identity,
representation/delegation, activity/licence, managed customer/supplier terms,
qualified tax treatment and retention/private-storage readiness are distinct.
TaxTreatmentSchema arithmetic alone is not a subject-bound tax review. Merchant,
refund/loss funding and supplier eligibility remain separate action-specific gates.

Managed policy kinds/schemas must be distinct: old MARKET/GOVERNING_TERMS describe
Brand–creator direct agreements and cannot become principal contracts by ID reuse.
Reuse their actual review/expiry/scope/ambiguity mechanics, not frozen parties.

First governing authority uses a deployment-controlled one-time reviewed manifest
with exact principal/controller/reviewer identities and authority evidence. No
ordinary app route bootstraps governance. Later appointment/revocation requires a
current authorized governing seat; principal approval requires separate qualified
review. Reject self-grant/extension/approval. SIGN additionally needs independently
reviewed representation; operational assignment alone cannot confer it. Governing
authority bootstrap/recovery remains the controlled route.

## Native scope and acceptance

Before private hydration and again after waits/before commit, including replay,
prove actual active native user/session, exact order/submission, current grant/
authorization chain, active principal version/readiness and actual-clock validity.
Group required user/reviewer locks before session/domain locks; no late actor lock,
nested transaction, provider call or stale-clock acceptance. Writes are DB-only,
bounded retries with immutable payload-bound journals and no duplicate effects.

VIEW exposes submitted immutable scope only, never live planning/context/files,
conversation or unsubmitted agency drafts. ISSUE/SIGN stay separate and cannot
impersonate customer approval or creator consent. Issued commitments freeze actual
principal/signer/authority/evidence/policy versions. Revocation blocks new actions
without rewriting accepted snapshots/obligations. Restrictive retained references
and qualified privacy policy do not imply continued access.

Independent native tests must prove wrong principal/order/submission, expired or
withdrawn grants/authorizers, deleted/expired qualified evidence/policies, actor
revocation/expiry across real waits, self-escalation, exact/conflicting replay,
concurrent issuance and supplier/unsubmitted-content exclusion. Local synthetic
fixtures prove mechanics only. Production rejects fixture provenance/unsafe
bootstrap/missing evidence. Live contracts, payments, publication and providers
remain explicitly gated; OpenAI stays disabled.

Source anchors: admin/context.ts; evidence/storage.ts; commercial/contracts.ts;
policies.ts; organization native context/authority; managed customer/source/order
modules; docs/plans/09-m04-managed-orders.md and09-managed-platform M04–M06.

## M04B1 contract freeze

First root-owned runtime exports are ManagedAuthorityValiditySchema,
PrincipalPartySchema and ManagedOperationalGrantSchema in managed/principal-contracts.
Independent four-group pure failures precede validation implementation. This slice
cannot provision a principal/seat/grant or establish professional/live readiness.

Validity is {validFrom:UTC,expiresAt:UTC|null,recheckAt:UTC}, supported years1..9999,
validFrom<recheckAt and if expiry exists validFrom<expiry/recheckAt<=expiry. No
client-supplied current clock. Original party fields are legalNameOriginal,
tradingNameOriginal|null,legalFormOriginal,jurisdiction,registration{authorityOriginal,
identifier},registeredAddressOriginal. Required originals preserve whitespace but
are nonblank and reject unsafe C0/DEL; names/forms/authority/identifier max500,
address2000. Country/language reuse central vocabulary, not inference.

Grant common strict shape: schemaVersion1,id,revision,state ACTIVE|PAUSED|REVOKED,
provenance LIVE|DEVELOPMENT_FIXTURE,operatorUserId,principalId,principalVersionId,
principalSourceHash,binding{orderId,workspaceId,campaignId,submissionId,
submissionVersion,submissionHash},grantor{userId,governanceSeatId,
governanceSeatRevision},authorizationEvidence{id,revision,sourceHash},validity,
sourceHash. Grantor must differ from operator; this does not prove governing rights.

Executable purposes are VIEW_SUBMITTED_ORDER with accessPolicy pin kind
MANAGED_SUBMISSION_ACCESS, and ISSUE_RETAIL_QUOTE with quotePolicy kind
MANAGED_QUOTE_POLICY/customerTermsPolicy kind MANAGED_CUSTOMER_TERMS/taxPolicy kind
MANAGED_TAX_TREATMENT, positive central Money maximumGross and explicit unique
marketCountryCodes1..50. Every policy pin is {versionId,kind,contentHash}. VIEW
rejects quote/money fields; SIGN is absent/rejected until represented signing is
implemented. All objects reject unknown actor/session/asset-byte/storage/supplier/
source-content fields. IDs/revisions/hash use central ASCII/bounds/lowerSHA256.
Qualified evidence/current-state/native controlled bootstrap remain the following
separately frozen mission; no fake principal or broadened ADMIN helper is seeded.

## M04B2 principal aggregate storage

Prerequisites: a19ce63 strict party/validity/grant declarations and the accepted
managed request flow. This bounded checkpoint implements only principal identity,
immutable declared versions and revisioned current state. ACTIVE is storage
availability, not qualified legal/service authority. No app route, legal entity,
operator seat, evidence, policy, quote, bootstrap or signing is activated.

Root owns principal-registry-contracts.ts, Prisma/additive migration21 and shared
docs. commercial_principal_scout independently authors three pure groups in an
ignored draft; managed_route_witnesses authors bounded native SQL groups after
the exact aggregate is frozen. managed_ui_review independently reviews source.
Only root runs databases/checks/adopts tests. Other work remains preserved.

Version content is strict schemaVersion1/principalId/provenance/version/party/
declaredActivityKeys/marketCountryCodes. Activities are unique lowercase ASCII
kebab keys1..50, each1..100 starting with a letter; markets are unique assigned
ISO codes1..50. The retained version adds id/sourceHash/createdAt; sourceHash is
the canonical hash of content only, with no normalization or mutable state.
State is strict principalId/revision/state/currentVersion/createdAt/updatedAt;
the pointer is id/version/sourceHash or null. DRAFT requires null, ACTIVE/PAUSED
require a full pointer; REVOKED retains either initial absence or its old pointer.
UTC instants use supported years1..9999 and updatedAt cannot precede creation.

Three additive SQL-owned scalar sidecars retain stable provenance, immutable
versions, exact composite current identity/hash/ordinal and RESTRICT history.
Initial state is DRAFT/revision1; versions advance exactly one under their stable
parent lock. State revisions advance exactly one; provenance/identity/creation
are immutable, pointers never regress, and REVOKED is terminal. Current pointer
availability never substitutes for later subject-bound qualified evidence.
Native failures cover cross-principal/hash/version pointers, skipped/reused
versions/state revisions, immutable edits, terminal revival and restrictive
deletion. Test subjects are explicitly synthetic and not provisioned authority.
The compact declaration cap is131072 UTF8 bytes. SQL validates bounded exact
binding/shape; strict original/country vocabulary and canonical hash validation
remain in the runtime schema. Versions cannot be deleted while their state
exists. A state cannot be recreated over retained versions. Task-only cleanup
deletes state then versions then principal; later commercial/evidence references
retain their own restrictive FKs and prohibit deleting referenced history.

All four repository gates and independent review are required before commit.

## M04B3 qualified evidence declarations

Prerequisite: reviewed5054335 principal storage, no changed historical request or
legacy parties. This checkpoint is pure validation only. Root owns
managed/qualified-evidence-contracts.ts, adopted tests/managed/qualified-evidence-
contracts.test.ts and shared docs. commercial_principal_scout owns its ignored
three-group test draft; managed_ui_review independently reviews source. Native
controlled provisioning/qualifications/evidence/policy storage follows separately.

Qualification content is schemaVersion1/userId/provenance/version/discipline/
jurisdictionCountryCodes/authoritySource/validity. The source is an explicit
DEPLOYMENT_ATTESTATION manifest ID/hash, safe original reference max2000 and
observation UTC. Jurisdictions are unique assignedISO1..50, separate from campaign
market/residence/UI language. Disciplines are ENTITY_REGISTRATION,PERSON_IDENTITY,
ACTIVITY_PERMISSION,REPRESENTATION,CONTRACT_TERMS,TAX,PRIVATE_STORAGE. Customer and
supplier terms map to CONTRACT_TERMS; other checks map to their named discipline.
Stored version adds id/sourceHash/createdAt; hash only content, creation>=source
observation. A declared source is not a trusted deployment attestation.

Evidence content is schemaVersion1/evidenceId/reviewRevision/provenance/subject/
checkKind/source/reviewer/observedAt/reviewedAt/decision/validity/coverage/
independence. ENTITY_VERSION pins exact principal/version/hash and supports entity
checks; NATURAL_USER additionally pins user and personIdentityEvidence. Identity
check requires null identity pin to avoid recursion; REPRESENTATION requires its
full id/revision/hash pin. Those two checks require natural subjects exclusively.
Source is EXTERNAL_RECORD original reference/observationHash or PRIVATE_ASSET
assetId/ownerUserId/checksum/purpose MANAGED_PRINCIPAL_EVIDENCE. This adds no asset
upload/storage capability or permission. Reviewer pins actual user plus immutable
qualification ID/version/hash; shape cannot prove actual current qualification.

Coverage retains unique activities0..50, markets0..50 and up to six unique-kind
managed document pins: submission access, quote policy, customer terms, supplier
terms, tax treatment and privacy retention. Empty coverage claims nothing. A
reviewer differs from natural subject and declared nonnull controller/operator.
Null means not-applicable declaration only; trusted runtime must reject null when
an actual controller/operator exists and validate exact actual independence.
Asset custody is separate. APPROVED requires review before recheck/any expiry;
all decisions require review>=observation. Retained version creation>=review and
hashes content only. Historical rejected/recheck decisions may be out of validity.
UTC/year/original safety/bounds use the existing codecs; malformed oversize
safeParse returns failure without reaching the canonical hash exception.

Three independent pure groups cover originals/source variants/hashes, strict
subject/discipline/independence/bounds and chronology/expiry/oversize failures.
These declarations grant no qualified/legal/native authority. Future runtime
binds actual qualifications/controlled anchors/subjects/assets/policies, checks
real bytes at review outside retried writes, enforces current/final native scope
and rejects fixtures in production. OpenAI stays disabled.
