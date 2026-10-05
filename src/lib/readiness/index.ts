import { Prisma } from "@prisma/client";
import { checkProfileActor, withProfileActorTransaction, organizationDb,
  type OrganizationActor, type OrganizationOptions } from "@/lib/organizations/context";
import { createEvidenceReceiptReader, type EvidenceReceiptReader } from "@/lib/evidence/receipt-reader";
import type { EvidenceActorLocks } from "@/lib/evidence/readiness";
import { canonicalHash, OnboardingError, record, type DraftState } from "@/lib/onboarding/drafts";
import { assertPublicationPrerequisites, assertPublicationAccountSelection, currentPublicationPortfolio,
  type PublishProfile, type PublishCreator, type PublishBrand } from "@/lib/onboarding/publication-prerequisites";
import { PublicationBlockerSchema, PublicationReadinessQuerySchema, PublicationReadinessSchema,
  ReadinessError, publicationRemedies, type PublicationReadiness } from "./contracts";
export type ReadinessOptions = OrganizationOptions & { now?: Date };
type Tx = Prisma.TransactionClient;
type Role = "CREATOR" | "BRAND";
const retry = (): never => { throw new ReadinessError("RETRY_REQUIRED", 503); };
async function read<T>(reader: EvidenceReceiptReader, query: () => Promise<T>): Promise<T> {
  reader.checkpoint(); try { return await query(); } finally { reader.checkpoint(); }
}
const accountCapture = { id: true, creatorId: true, ownershipReviewedBy: true,
  mappingRevision: true, evidenceRevision: true, ownershipStatus: true, ownershipReviewedAt: true,
  ownershipProofAssetId: true, ownershipIdentityHash: true, intendedConfirmedAt: true, consentAt: true,
  platform: true, handle: true, providerAccountId: true } as const;
// Only references needed to acquire and recheck proof actors are captured.
async function related(tx: Tx, role: Role, profileId: string, now: Date, reader: EvidenceReceiptReader) {
  if (role === "CREATOR") {
    const rows = await read(reader, () => tx.socialAccount.findMany({ where: { creatorId: profileId }, select: accountCapture,
      orderBy: { id: "asc" }, take: 101 }));
    if (rows.length > 100) return retry();
    const reviewers = rows.flatMap(row => row.ownershipReviewedBy ? [row.ownershipReviewedBy] : []);
    const fingerprints = rows.map(row => { reader.checkpoint(); return canonicalHash(JSON.parse(JSON.stringify(row))); });
    reader.checkpoint(); return { reviewers, fingerprints, ids: rows.map(row => row.id) };
  }
  const rows = await read(reader, () => tx.businessVerification.findMany({ where: { brandId: profileId,
    kind: "REPRESENTATIVE", status: "VERIFIED", reviewedAt: { lte: now }, reviewedBy: { not: null },
    OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }, select: { id: true, brandId: true, kind: true,
    status: true, revision: true, reviewedBy: true, reviewedAt: true, expiresAt: true }, orderBy: { id: "asc" }, take: 101 }));
  if (rows.length > 100) return retry();
  const reviewers = rows.flatMap(row => row.reviewedBy ? [row.reviewedBy] : []);
  const fingerprints = rows.map(row => { reader.checkpoint(); return canonicalHash(JSON.parse(JSON.stringify(row))); });
  reader.checkpoint(); return { reviewers, fingerprints, ids: rows.map(row => row.id) };
}
async function thinProfile(tx: Tx, role: Role, id: string, actorId: string, reader: EvidenceReceiptReader): Promise<PublishProfile> {
  if (role === "CREATOR") {
    const rows = await read(reader, () => tx.$queryRaw<PublishCreator[]>`SELECT id,"userId","primaryAccountId","countryCode","timeZone",languages,"nicheIds",currency,
      jsonb_build_object('mappingHash',"profileFacts"->'mappingHash') AS "profileFacts" FROM "Creator" WHERE id=${id} AND "userId"=${actorId}`);
    if (rows.length !== 1) return retry(); return { role, creator: rows[0]! };
  }
  const rows = await read(reader, () => tx.$queryRaw<PublishBrand[]>`SELECT id,"userId","countryCode","timeZone",
    jsonb_build_object('languages',"profileFacts"->'languages','targetMarkets',"profileFacts"->'targetMarkets','preferredCurrency',"profileFacts"->'preferredCurrency') AS "profileFacts"
    FROM "Brand" WHERE id=${id} AND "userId"=${actorId}`);
  if (rows.length !== 1) return retry(); return { role, brand: rows[0]! };
}
export async function getPublicationReadiness(
  actorInput: OrganizationActor, input: unknown = {}, options: ReadinessOptions = {},
): Promise<PublicationReadiness> {
  const actor = Object.freeze({ userId: actorInput?.userId, role: actorInput?.role,
    sessionId: actorInput?.sessionId, sessionVersion: actorInput?.sessionVersion });
  const reader = createEvidenceReceiptReader(), checkpoint = () => reader.checkpoint();
  await checkProfileActor(actor, options, checkpoint);
  const parsed = PublicationReadinessQuerySchema.safeParse(input);
  if (!parsed.success) throw new ReadinessError("VALIDATION", 422);
  const query = parsed.data, role = actor.role as Role;
  if (options.now !== undefined && (!(options.now instanceof Date) || !Number.isFinite(options.now.getTime()))) throw new ReadinessError("INVALID_CLOCK", 400);
  const now = new Date(options.now?.getTime() ?? Date.now());
  const capture = await read(reader, () => organizationDb(options).$transaction(async tx => {
    const profile = role === "CREATOR"
      ? await read(reader, () => tx.creator.findUnique({ where: { userId: actor.userId }, select: { id: true, userId: true, primaryAccountId: true } }))
      : await read(reader, () => tx.brand.findUnique({ where: { userId: actor.userId }, select: { id: true, userId: true } }));
    if (!profile || profile.userId !== actor.userId) throw new ReadinessError("NOT_FOUND", 404);
    const draft = await read(reader, () => tx.onboardingDraft.findUnique({ where: { userId_kind: { userId: actor.userId, kind: role } },
      select: { id: true, userId: true, kind: true, revision: true } }));
    const identities = draft ? await related(tx, role, profile.id, now, reader) : { reviewers: [], fingerprints: [], ids: [] };
    return { profile, draft, identities };
  }, { isolationLevel: "RepeatableRead", maxWait: 10000, timeout: 20000 }));
  return withProfileActorTransaction(actor, options, { write: false, reviewerIds: capture.identities.reviewers, checkpoint }, async (tx, ownerIds, reviewerIds) => {
    if (capture.draft) await read(reader, () => tx.$queryRaw`SELECT id FROM "OnboardingDraft" WHERE id=${capture.draft!.id} FOR SHARE`);
    await read(reader, () => role === "CREATOR" ? tx.$queryRaw`SELECT id FROM "Creator" WHERE id=${capture.profile.id} FOR SHARE`
      : tx.$queryRaw`SELECT id FROM "Brand" WHERE id=${capture.profile.id} FOR SHARE`);
    const profile = await thinProfile(tx, role, capture.profile.id, actor.userId, reader);
    if (profile.role === "CREATOR" && "primaryAccountId" in capture.profile && profile.creator.primaryAccountId !== capture.profile.primaryAccountId) return retry();
    let draft: { id: string; userId: string; kind: string; revision: number } | null = null;
    // RepeatableRead's snapshot precedes the owner-lock wait. This fresh scalar
    // identity probe runs while that native owner lock is held, so conforming
    // draft writers cannot race it; it opens no nested transaction or lock.
    const currentDraft = await read(reader, () => organizationDb(options).onboardingDraft.findUnique({ where: { userId_kind: { userId: actor.userId, kind: role } },
      select: { id: true } }));
    if ((currentDraft?.id ?? null) !== (capture.draft?.id ?? null)) return retry();
    if (capture.draft) {
      draft = await read(reader, () => tx.onboardingDraft.findUnique({ where: { id: capture.draft!.id }, select: { id: true, userId: true, kind: true, revision: true } }));
      if (!draft || draft.userId !== actor.userId || draft.kind !== role) return retry();
      if (capture.identities.ids.length) await read(reader, () => role === "CREATOR"
        ? tx.$queryRaw(Prisma.sql`SELECT id FROM "SocialAccount" WHERE "creatorId"=${capture.profile.id}
          AND id IN (${Prisma.join(capture.identities.ids)}) ORDER BY id FOR SHARE`)
        : tx.$queryRaw(Prisma.sql`SELECT id FROM "BusinessVerification" WHERE "brandId"=${capture.profile.id}
          AND id IN (${Prisma.join(capture.identities.ids)}) ORDER BY id FOR SHARE`));
      const current = await related(tx, role, capture.profile.id, now, reader);
      if (JSON.stringify(current.fingerprints) !== JSON.stringify(capture.identities.fingerprints)) return retry();
    }
    // Action time follows native domain waits, as in the publication command.
    // Clock-only expiry may remove a candidate; a newly eligible actor instead
    // requires fresh capture rather than a late User lock.
    const assessmentNow = options.now === undefined ? new Date() : now;
    if (draft) {
      const current = await related(tx, role, capture.profile.id, assessmentNow, reader);
      if (current.ids.some(id => !capture.identities.ids.includes(id))) return retry();
    }
    const actors: EvidenceActorLocks = { ownerIds, reviewerIds,
      creatorOwners: new Map(profile.role === "CREATOR" ? [[profile.creator.id, profile.creator.userId]] : []),
      brandOwners: new Map(profile.role === "BRAND" ? [[profile.brand.id, profile.brand.userId]] : []) };
    const portfolio = draft ? await currentPublicationPortfolio(tx, role, capture.profile.id, reader) : null;
    let blocker: PublicationReadiness["blockerCode"] = draft ? null : "DRAFT_REQUIRED";
    if (draft) {
      const rows = await read(reader, () => tx.$queryRaw<Array<{ sources: Prisma.JsonValue; stale: Prisma.JsonValue }>>`SELECT "input"->'sources' AS sources,
        "input"->'generatedSectionsStale' AS stale FROM "OnboardingDraft" WHERE id=${draft!.id}`);
      if (rows.length !== 1) return retry();
      const state: Pick<DraftState, "sources" | "generatedSectionsStale"> = {
        sources: record(rows[0]!.sources) as DraftState["sources"], generatedSectionsStale: rows[0]!.stale === true,
      };
      try {
        await assertPublicationPrerequisites(tx, { actorUserId: actor.userId, profile, state,
          payload: { consent: true, portfolioVersion: query.portfolioVersion ?? portfolio?.version ?? 0, visibleAccountIds: query.visibleAccountIds }, actors, now: assessmentNow, reader });
        if (profile.role === "CREATOR") await assertPublicationAccountSelection(tx, { actorUserId: actor.userId,
          creator: profile.creator, visibleAccountIds: query.visibleAccountIds, actors, now: assessmentNow, reader });
      } catch (error) {
        if (!(error instanceof OnboardingError)) throw error;
        const code = PublicationBlockerSchema.safeParse(error.code); if (!code.success) throw error; blocker = code.data;
      }
    }
    reader.checkpoint();
    const result = PublicationReadinessSchema.parse({ scope: "OWN_PROFILE", role, profileId: capture.profile.id, asOf: assessmentNow.toISOString(),
      draftId: draft?.id ?? null, draftRevision: draft?.revision ?? null, portfolioVersion: portfolio?.version ?? null,
      requiresExplicitPublicationConsent: true, status: blocker ? "BLOCKED" : "READY_FOR_REVIEW", blockerCode: blocker,
      remedies: publicationRemedies(role, blocker) });
    await read(reader, () => tx.adminAudit.create({ data: { actorUserId: actor.userId, action: "publication.readiness_accessed",
      resourceType: "PublicationReadiness", resourceId: capture.profile.id, snapshot: { role, asOf: result.asOf,
        draftRevision: result.draftRevision, portfolioVersion: result.portfolioVersion, status: result.status, blockerCode: result.blockerCode } } }));
    reader.checkpoint(); return result;
  });
}
