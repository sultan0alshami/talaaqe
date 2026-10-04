import { z } from "zod";
import { ApiError, parseBody, requireRole } from "@/lib/api";
import { domainHandler } from "@/lib/domain-api";
import { prisma } from "@/lib/prisma";
import { MAX_EVIDENCE_BYTES } from "./limits";
import { EvidenceError } from "./storage";
import { evidenceOptionsForSession } from "./runtime";
import { Id, Key, type EvidenceOptions } from "./common";
import {
  AssetPurposeSchema, EvidenceQueueQuerySchema, uploadPrivateAsset, getPrivateAsset, getCreatorEvidence, getBrandEvidence, listEvidenceReviewQueue,
  createOwnershipChallenge, submitOwnershipProof, reviewOwnershipProof, submitMetricsScreenshot, reviewMetricsScreenshot, approveMetricsSnapshot,
  submitFactCorrection, approveFactCorrection, submitAdvertisingLicence, reviewAdvertisingLicence, submitBusinessVerification, reviewBusinessVerification,
  listLicencePolicyOptions, LicencePolicyOptionsQuerySchema,
} from "./service";

export const loadEvidence = domainHandler(async () => {
  const session = await requireRole("CREATOR", "BRAND"), options = await evidenceOptionsForSession(session);
  const profile = session.role === "CREATOR" ? await prisma.creator.findUnique({ where: { userId: session.userId }, select: { id: true } })
    : await prisma.brand.findUnique({ where: { userId: session.userId }, select: { id: true } });
  if (!profile) throw new EvidenceError("NOT_FOUND", 404);
  return session.role === "CREATOR" ? getCreatorEvidence(session.userId, profile.id, options) : getBrandEvidence(session.userId, profile.id, options);
});

export async function readEvidenceUpload(request: Request): Promise<Uint8Array> {
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_EVIDENCE_BYTES)) throw new EvidenceError("INVALID_ASSET_SIZE", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new EvidenceError("INVALID_ASSET_SIZE", 413);
  let failure: EvidenceError | undefined;
  let rejectBoundary!: (error: EvidenceError) => void;
  const interrupted = new Promise<never>((_resolve, reject) => { rejectBoundary = reject; });
  function interrupt(code: "UPLOAD_TIMEOUT" | "UPLOAD_ABORTED") {
    if (failure) return;
    failure = new EvidenceError(code, 408);
    rejectBoundary(failure);
    // A producer's cancellation hook must not hold the HTTP response open.
    void reader!.cancel().catch(() => {});
  }
  const aborted = () => interrupt("UPLOAD_ABORTED");
  const deadline = setTimeout(() => interrupt("UPLOAD_TIMEOUT"), 20_000);
  request.signal.addEventListener("abort", aborted, { once: true });
  if (request.signal.aborted) aborted();
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const part = await Promise.race([reader.read(), interrupted]);
      if (failure) throw failure;
      if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_EVIDENCE_BYTES) { void reader.cancel().catch(() => {}); throw new EvidenceError("INVALID_ASSET_SIZE", 413); }
      chunks.push(part.value);
    }
  } finally { clearTimeout(deadline); request.signal.removeEventListener("abort", aborted); reader.releaseLock(); }
  if (!size) throw new EvidenceError("INVALID_ASSET_SIZE", 413);
  return new Uint8Array(Buffer.concat(chunks, size));
}
export const uploadEvidence = domainHandler(async (request: Request) => {
  const session = await requireRole("CREATOR", "BRAND", "ADMIN");
  const purpose = AssetPurposeSchema.safeParse(request.headers.get("x-evidence-purpose"));
  const operationKey = Key.safeParse(request.headers.get("x-operation-key"));
  if (!purpose.success || !operationKey.success) throw new EvidenceError("VALIDATION", 422);
  const options = await evidenceOptionsForSession(session);
  return uploadPrivateAsset(session.userId, { operationKey: operationKey.data, purpose: purpose.data,
    contentType: request.headers.get("content-type") ?? "", bytes: await readEvidenceUpload(request) }, options);
});
export const downloadEvidence = domainHandler(async (_request: Request, context: { params: Promise<{ id: string }> }) => {
  const session = await requireRole("CREATOR", "BRAND", "ADMIN"), { id } = await context.params;
  const file = await getPrivateAsset(session.userId, id, await evidenceOptionsForSession(session));
  return new Response(new Uint8Array(file.bytes), { headers: file.headers });
});
export const loadEvidenceQueue = domainHandler(async (request: Request) => {
  const session = await requireRole("ADMIN");
  const values: Record<string, unknown> = Object.fromEntries(new URL(request.url).searchParams);
  if (values.limit !== undefined) {
    if (typeof values.limit !== "string" || !/^[1-9][0-9]?$/.test(values.limit)) throw new EvidenceError("VALIDATION", 422);
    values.limit = Number(values.limit);
  }
  const query = EvidenceQueueQuerySchema.safeParse(values);
  if (!query.success) throw new EvidenceError("VALIDATION", 422);
  return listEvidenceReviewQueue(session.userId, query.data, await evidenceOptionsForSession(session));
});

export const loadLicencePolicyOptions = domainHandler(async (request: Request, context: { params: Promise<{ id: string }> }) => {
  const session = await requireRole("ADMIN"), { id } = await context.params;
  if (!Id.safeParse(id).success) throw new EvidenceError("VALIDATION", 422);
  const values: Record<string, unknown> = {};
  for (const [key, value] of new URL(request.url).searchParams) {
    if (Object.hasOwn(values, key) || !["cursor", "limit"].includes(key)) throw new EvidenceError("VALIDATION", 422);
    values[key] = value;
  }
  if (values.limit !== undefined) {
    if (typeof values.limit !== "string" || !/^[1-9][0-9]?$/.test(values.limit)) throw new EvidenceError("VALIDATION", 422);
    values.limit = Number(values.limit);
  }
  const query = LicencePolicyOptionsQuerySchema.safeParse(values);
  if (!query.success) throw new EvidenceError("VALIDATION", 422);
  return listLicencePolicyOptions(session.userId, id, await evidenceOptionsForSession(session), query.data);
});

type Operation = { roles: readonly ("CREATOR" | "BRAND" | "ADMIN")[]; run: (actor: string, resourceId: string | undefined, command: unknown, options: EvidenceOptions) => Promise<unknown> };
function resource(id: string | undefined) { if (!id) throw new EvidenceError("VALIDATION", 422); return id; }
const operations = {
  OWNERSHIP_START: { roles: ["CREATOR"], run: (actor, _id, command, options) => createOwnershipChallenge(actor, command, options) },
  OWNERSHIP_SUBMIT: { roles: ["CREATOR"], run: (actor, id, command, options) => submitOwnershipProof(actor, resource(id), command, options) },
  OWNERSHIP_REVIEW: { roles: ["ADMIN"], run: (actor, id, command, options) => reviewOwnershipProof(actor, resource(id), command, options) },
  SCREENSHOT_SUBMIT: { roles: ["CREATOR"], run: (actor, _id, command, options) => submitMetricsScreenshot(actor, command, options) },
  SCREENSHOT_REVIEW: { roles: ["ADMIN"], run: (actor, id, command, options) => reviewMetricsScreenshot(actor, resource(id), command, options) },
  METRICS_APPROVE: { roles: ["CREATOR"], run: (actor, id, command, options) => approveMetricsSnapshot(actor, resource(id), command, options) },
  CORRECTION_SUBMIT: { roles: ["CREATOR"], run: (actor, _id, command, options) => submitFactCorrection(actor, command, options) },
  CORRECTION_APPROVE: { roles: ["CREATOR"], run: (actor, id, command, options) => approveFactCorrection(actor, resource(id), command, options) },
  LICENCE_SUBMIT: { roles: ["CREATOR"], run: (actor, _id, command, options) => submitAdvertisingLicence(actor, command, options) },
  LICENCE_REVIEW: { roles: ["ADMIN"], run: (actor, id, command, options) => reviewAdvertisingLicence(actor, resource(id), command, options) },
  BUSINESS_SUBMIT: { roles: ["BRAND"], run: (actor, _id, command, options) => submitBusinessVerification(actor, command, options) },
  BUSINESS_REVIEW: { roles: ["ADMIN"], run: (actor, id, command, options) => reviewBusinessVerification(actor, resource(id), command, options) },
} satisfies Record<string, Operation>;
const CommandSchema = z.object({ action: z.enum(Object.keys(operations) as [keyof typeof operations, ...(keyof typeof operations)[]]), resourceId: Id.optional(), command: z.unknown() }).strict();
export const commandEvidence = domainHandler(async (request: Request) => {
  const session = await requireRole("CREATOR", "BRAND", "ADMIN"), input = await parseBody(request, CommandSchema);
  const operation: Operation = operations[input.action];
  if (!operation.roles.includes(session.role)) throw new ApiError(403, "Forbidden");
  return operation.run(session.userId, input.resourceId, input.command, await evidenceOptionsForSession(session));
});
