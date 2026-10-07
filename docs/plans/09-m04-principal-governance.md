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
