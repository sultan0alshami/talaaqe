import { z } from "zod";
import type { AdvertisingLicence, BusinessVerification } from "@prisma/client";
import { CountryCodeSchema, PlatformSchema, UtcDateTimeSchema } from "@/lib/contracts/vocabulary";
import { MarketPolicyContentSchema } from "@/lib/policies";
import { brandContext, canonicalHash, creatorContext, event, Id, identityHash, Key, lock, parse, previous, receipt, record, requireMapping, requireRevision, Revision, Review, reviewLanguage, transaction, type EvidenceOptions, type Tx } from "./common";
import { usableAsset } from "./assets";
import { EvidenceError } from "./storage";
const text = z.string().trim().min(1).max(500);
const Bindings = z.array(z.object({ accountId: Id, mappingRevision: Revision }).strict()).min(1).max(20).refine(rows => new Set(rows.map(r => r.accountId)).size === rows.length);
const Licence = z.object({ operationKey: Key, creatorId: Id, jurisdiction: CountryCodeSchema, issuer: text, holderName: text, licenceNumber: text,
  type: text, scope: text, accountBindings: Bindings, platformScope: z.array(PlatformSchema).min(1).max(5).refine(p => new Set(p).size === p.length),
  evidenceAssetId: Id, validFrom: UtcDateTimeSchema, expiresAt: UtcDateTimeSchema }).strict().refine(r => Date.parse(r.validFrom) < Date.parse(r.expiresAt));
const LicenceReview = Review.extend({ policyVersionId: Id.optional() }).strict();
export function licenceScope(l: AdvertisingLicence) { return { jurisdiction: l.jurisdiction, issuer: l.issuer, holderName: l.holderName, licenceNumber: l.licenceNumber,
  type: l.type, scope: l.scope, accountIds: [...l.accountIds].sort(), platformScope: [...l.platformScope].sort(), evidenceAssetId: l.evidenceAssetId,
  validFrom: l.validFrom?.toISOString() ?? null, expiresAt: l.expiresAt?.toISOString() ?? null }; }
export async function licenceDTO(tx: Tx, l: AdvertisingLicence) { return { id: l.id, creatorId: l.creatorId, revision: l.revision, ...licenceScope(l), status: l.status,
  policyVersion: l.policyVersion, reviewMethod: l.reviewMethod, reviewedAt: l.reviewedAt?.toISOString() ?? null,
  reviewNote: l.reviewNote ? { text: l.reviewNote, language: await reviewLanguage(tx, "AdvertisingLicence", l.id, l.revision) } : null }; }
export async function submitAdvertisingLicence(actor: string, input: unknown, options: EvidenceOptions) {
  const command = parse(Licence, input), hash = canonicalHash({ action: "SUBMIT_LICENCE", ...command });
  return transaction(options, actor, async (tx, now, boundary) => {
    const creator = await creatorContext(tx, actor, command.creatorId);
    now = await boundary.checkpoint();
    const replay = await previous(tx, actor, command.operationKey, hash);
    if (replay) return { licence: await licenceDTO(tx, await tx.advertisingLicence.findUniqueOrThrow({ where: { id: replay.resourceId } })), replayed: true };
    const bindings = [];
    for (const binding of [...command.accountBindings].sort((a, b) => a.accountId < b.accountId ? -1 : 1)) {
      await lock(tx, "SocialAccount", binding.accountId);
      const account = await tx.socialAccount.findUnique({ where: { id: binding.accountId } });
      if (!account || account.creatorId !== creator.id || !command.platformScope.includes(account.platform)) throw new EvidenceError("INVALID_SCOPE");
      requireMapping(account, binding.mappingRevision); bindings.push({ ...binding, identityHash: identityHash(account) });
    }
    const accounts = await tx.socialAccount.findMany({ where: { id: { in: bindings.map(b => b.accountId) } } });
    now = await boundary.checkpoint();
    if (command.platformScope.some(p => !accounts.some(a => a.platform === p)) || Date.parse(command.expiresAt) <= now.getTime()) throw new EvidenceError("INVALID_SCOPE");
    await usableAsset(tx, command.evidenceAssetId, actor, "ADVERTISING_LICENCE", options, boundary);
    now = await boundary.checkpoint();
    if (Date.parse(command.expiresAt) <= now.getTime()) throw new EvidenceError("INVALID_SCOPE");
    const licence = await tx.advertisingLicence.create({ data: { creatorId: creator.id, jurisdiction: command.jurisdiction, issuer: command.issuer,
      holderName: command.holderName, licenceNumber: command.licenceNumber, type: command.type, scope: command.scope, accountIds: bindings.map(b => b.accountId),
      platformScope: command.platformScope, evidenceAssetId: command.evidenceAssetId, validFrom: new Date(command.validFrom), expiresAt: new Date(command.expiresAt), createdAt: now, updatedAt: now } });
    await receipt(tx, actor, command.operationKey, hash, "AdvertisingLicence", licence.id, 1, now, { scopeBindings: bindings, ownerUserId: actor,
      creatorCountryCode: creator.countryCode, scopeHash: canonicalHash(licenceScope(licence)) });
    await event(tx, actor, command.operationKey, "licence.submitted", "AdvertisingLicence", licence.id, 1, now, { jurisdiction: command.jurisdiction });
    return { licence: await licenceDTO(tx, licence), replayed: false };
  });
}
export async function reviewAdvertisingLicence(actor: string, id: string, input: unknown, options: EvidenceOptions) {
  parse(Id, id); const command = parse(LicenceReview, input), hash = canonicalHash({ action: "REVIEW_LICENCE", id, ...command });
  return transaction(options, actor, async (tx, now, boundary) => {
    const initial = await tx.advertisingLicence.findUnique({ where: { id } }); if (!initial) throw new EvidenceError("NOT_FOUND", 404);
    const initialPolicy = command.policyVersionId ? await tx.policyVersion.findUnique({ where: { id: command.policyVersionId } }) : null;
    const creator = await creatorContext(tx, actor, initial.creatorId, true, initialPolicy?.reviewedBy ? [initialPolicy.reviewedBy] : []);
    await lock(tx, "AdvertisingLicence", id);
    now = await boundary.checkpoint();
    const licence = await tx.advertisingLicence.findUniqueOrThrow({ where: { id } });
    const submission = await tx.evidenceCommand.findFirst({ where: { actorUserId: creator.userId!, resourceType: "AdvertisingLicence", resourceId: id }, orderBy: { createdAt: "asc" } });
    const metadata = record(submission?.resultJson);
    if (metadata.ownerUserId !== creator.userId || metadata.creatorCountryCode !== creator.countryCode || metadata.scopeHash !== canonicalHash(licenceScope(licence))) throw new EvidenceError("STALE_IDENTITY");
    const bindings = parse(z.array(z.object({ accountId: Id, mappingRevision: Revision, identityHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict()), metadata.scopeBindings);
    for (const binding of [...bindings].sort((a, b) => a.accountId < b.accountId ? -1 : 1)) {
      await lock(tx, "SocialAccount", binding.accountId); const account = await tx.socialAccount.findUnique({ where: { id: binding.accountId } });
      if (!account || account.creatorId !== creator.id || !licence.platformScope.includes(account.platform)) throw new EvidenceError("STALE_IDENTITY");
      requireMapping(account, binding.mappingRevision, binding.identityHash);
    }
    now = await boundary.checkpoint();
    const replay = await previous(tx, actor, command.operationKey, hash);
    if (replay) return { licence: await licenceDTO(tx, licence), replayed: true };
    requireRevision(licence.revision, command.expectedRevision);
    if (command.decision === "REVOKED" ? licence.status !== "VERIFIED" : !["PENDING", "NEEDS_RECHECK"].includes(licence.status)) throw new EvidenceError("INVALID_STATE");
    let policyVersion: string | null = licence.policyVersion;
    if (command.decision === "VERIFIED") {
      if (!initialPolicy?.reviewedBy || !command.policyVersionId) throw new EvidenceError("POLICY_UNAVAILABLE", 503);
      await lock(tx, "PolicyVersion", command.policyVersionId, true);
      now = await boundary.checkpoint();
      const policy = await tx.policyVersion.findUniqueOrThrow({ where: { id: command.policyVersionId } });
      const content = MarketPolicyContentSchema.safeParse(policy.content);
      if (policy.kind !== "MARKET" || policy.status !== "VERIFIED" || policy.reviewedBy !== initialPolicy.reviewedBy || !policy.reviewedAt || policy.reviewedAt > now || policy.reviewedAt < policy.createdAt
        || !policy.evidenceAssetId || policy.expiresAt && policy.expiresAt <= now || !content.success || !content.data.licencePolicyId || !policy.countryCodes.includes(licence.jurisdiction)
        || content.data.marketCountryCode !== licence.jurisdiction || !creator.countryCode || !content.data.creatorCountryCodes.includes(creator.countryCode)) throw new EvidenceError("POLICY_UNAVAILABLE", 503);
      if (!licence.evidenceAssetId || !licence.expiresAt || licence.expiresAt <= now || !licence.validFrom || licence.validFrom > now) throw new EvidenceError("INVALID_EVIDENCE");
      await usableAsset(tx, policy.evidenceAssetId, policy.reviewedBy, "LEGAL_POLICY_REVIEW", options, boundary);
      await usableAsset(tx, licence.evidenceAssetId, creator.userId!, "ADVERTISING_LICENCE", options, boundary);
      now = await boundary.checkpoint();
      if (policy.expiresAt && policy.expiresAt <= now) throw new EvidenceError("POLICY_UNAVAILABLE", 503);
      if (licence.expiresAt <= now || licence.validFrom > now) throw new EvidenceError("INVALID_EVIDENCE");
      policyVersion = content.data.licencePolicyId;
    }
    const updated = await tx.advertisingLicence.update({ where: { id }, data: { revision: { increment: 1 }, status: command.decision, policyVersion,
      reviewMethod: "MANUAL_REVIEW", reviewedBy: actor, reviewedAt: now, reviewNote: command.note.text, updatedAt: now } });
    await receipt(tx, actor, command.operationKey, hash, "AdvertisingLicence", id, updated.revision, now, { noteLanguage: command.note.language, reviewedMarketVersionId: initialPolicy?.id ?? null });
    await event(tx, actor, command.operationKey, "licence.reviewed", "AdvertisingLicence", id, updated.revision, now, { jurisdiction: licence.jurisdiction, status: command.decision });
    return { licence: await licenceDTO(tx, updated), replayed: false };
  });
}
const Business = z.object({ operationKey: Key, brandId: Id, kind: z.enum(["REPRESENTATIVE", "BUSINESS_REGISTRATION"]), jurisdiction: CountryCodeSchema,
  identifier: text, evidenceAssetId: Id, expiresAt: UtcDateTimeSchema.optional() }).strict();
export function businessScope(b: BusinessVerification) { return { kind: b.kind, jurisdiction: b.jurisdiction, identifier: b.identifier, evidenceAssetId: b.evidenceAssetId, expiresAt: b.expiresAt?.toISOString() ?? null }; }
export async function businessDTO(tx: Tx, b: BusinessVerification) { return { id: b.id, brandId: b.brandId, revision: b.revision, ...businessScope(b), status: b.status, reviewedAt: b.reviewedAt?.toISOString() ?? null,
  reviewNote: b.reviewNote ? { text: b.reviewNote, language: await reviewLanguage(tx, "BusinessVerification", b.id, b.revision) } : null }; }
export async function submitBusinessVerification(actor: string, input: unknown, options: EvidenceOptions) {
  const command = parse(Business, input), hash = canonicalHash({ action: "SUBMIT_BUSINESS_PROOF", ...command });
  return transaction(options, actor, async (tx, now, boundary) => {
    const brand = await brandContext(tx, actor, command.brandId);
    now = await boundary.checkpoint();
    const replay = await previous(tx, actor, command.operationKey, hash);
    if (replay) return { verification: await businessDTO(tx, await tx.businessVerification.findUniqueOrThrow({ where: { id: replay.resourceId } })), replayed: true };
    if (command.jurisdiction !== brand.countryCode || command.expiresAt && Date.parse(command.expiresAt) <= now.getTime()) throw new EvidenceError("INVALID_SCOPE");
    await usableAsset(tx, command.evidenceAssetId, actor, command.kind, options, boundary);
    now = await boundary.checkpoint();
    if (command.expiresAt && Date.parse(command.expiresAt) <= now.getTime()) throw new EvidenceError("INVALID_SCOPE");
    const verification = await tx.businessVerification.create({ data: { brandId: brand.id, kind: command.kind, jurisdiction: command.jurisdiction,
      identifier: command.identifier, evidenceAssetId: command.evidenceAssetId, expiresAt: command.expiresAt ? new Date(command.expiresAt) : null, createdAt: now, updatedAt: now } });
    await receipt(tx, actor, command.operationKey, hash, "BusinessVerification", verification.id, 1, now, { ownerUserId: actor, brandCountryCode: brand.countryCode, scopeHash: canonicalHash(businessScope(verification)) });
    await event(tx, actor, command.operationKey, "business.proof_submitted", "BusinessVerification", verification.id, 1, now, { kind: command.kind, jurisdiction: command.jurisdiction });
    return { verification: await businessDTO(tx, verification), replayed: false };
  });
}
export async function reviewBusinessVerification(actor: string, id: string, input: unknown, options: EvidenceOptions) {
  parse(Id, id); const command = parse(Review, input), hash = canonicalHash({ action: "REVIEW_BUSINESS_PROOF", id, ...command });
  return transaction(options, actor, async (tx, now, boundary) => {
    const initial = await tx.businessVerification.findUnique({ where: { id } }); if (!initial) throw new EvidenceError("NOT_FOUND", 404);
    const brand = await brandContext(tx, actor, initial.brandId, true); await lock(tx, "BusinessVerification", id);
    now = await boundary.checkpoint();
    const verification = await tx.businessVerification.findUniqueOrThrow({ where: { id } });
    const submission = await tx.evidenceCommand.findFirst({ where: { actorUserId: brand.userId, resourceType: "BusinessVerification", resourceId: id }, orderBy: { createdAt: "asc" } }), metadata = record(submission?.resultJson);
    if (metadata.ownerUserId !== brand.userId || metadata.brandCountryCode !== brand.countryCode || metadata.scopeHash !== canonicalHash(businessScope(verification))) throw new EvidenceError("STALE_IDENTITY");
    const replay = await previous(tx, actor, command.operationKey, hash);
    if (replay) return { verification: await businessDTO(tx, verification), replayed: true };
    requireRevision(verification.revision, command.expectedRevision);
    if (command.decision === "REVOKED" ? verification.status !== "VERIFIED" : !["PENDING", "NEEDS_RECHECK"].includes(verification.status)) throw new EvidenceError("INVALID_STATE");
    if (command.decision === "VERIFIED") {
      if (!verification.evidenceAssetId || verification.expiresAt && verification.expiresAt <= now) throw new EvidenceError("INVALID_EVIDENCE");
      await usableAsset(tx, verification.evidenceAssetId, brand.userId, verification.kind, options, boundary);
      now = await boundary.checkpoint();
      if (verification.expiresAt && verification.expiresAt <= now) throw new EvidenceError("INVALID_EVIDENCE");
    }
    const updated = await tx.businessVerification.update({ where: { id }, data: { revision: { increment: 1 }, status: command.decision, reviewedBy: actor, reviewedAt: now, reviewNote: command.note.text, updatedAt: now } });
    // Representation controls publication independently of local registration.
    if (verification.kind === "REPRESENTATIVE") await tx.brand.update({ where: { id: brand.id }, data: { state: "PRIVATE" } });
    await receipt(tx, actor, command.operationKey, hash, "BusinessVerification", id, updated.revision, now, { noteLanguage: command.note.language });
    await event(tx, actor, command.operationKey, "business.proof_reviewed", "BusinessVerification", id, updated.revision, now, { kind: verification.kind, status: command.decision });
    return { verification: await businessDTO(tx, updated), replayed: false };
  });
}
