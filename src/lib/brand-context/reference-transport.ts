// Ignored candidate only. Coordinator owns activation, runtime/helper changes,
// route exports and checks. Metadata helpers require no configured byte storage.
import { z } from "zod";
import { requireRole } from "@/lib/api";
import { domainHandler } from "@/lib/domain-api";
import { checkOrganizationActor } from "@/lib/organizations/context";
import { evidenceOptionsForSession } from "@/lib/evidence/runtime";
import { MAX_EVIDENCE_BYTES } from "@/lib/evidence/limits";
import { EvidenceError } from "@/lib/evidence/storage";
import { BrandContextError } from "@/lib/brand-context/contracts";
import {
  ContextReferenceCommandSchema, ContextReferenceQuerySchema,
  ContextReferenceAssetQuerySchema, ContextReviewReferenceAssetQuerySchema,
} from "@/lib/brand-context/reference-contracts";
import {
  getContextReferences, executeContextReferenceCommand, getContextReferenceAsset,
  getContextReviewReferences, getContextReviewReferenceAsset,
  getCampaignReviewReferences, getCampaignReviewReferenceAsset,
} from "@/lib/brand-context/references";

const JSON_WIRE_BYTES = 96 * 1024;
const METADATA_BYTES = 64 * 1024;
const UPLOAD_WIRE_BYTES = MAX_EVIDENCE_BYTES + JSON_WIRE_BYTES;
const BODY_TIMEOUT_MS = 20_000;
const FILE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "application/pdf"]);
const ReviewQuerySchema = ContextReviewReferenceAssetQuerySchema.omit({ bindingId: true }).strict();
// Only the server reconstructs contentType/bytes. The final command schema then
// rejects unknown top-level fields and validates all scope/revision/original text.
const UploadMetadataSchema = z.object({
  action: z.literal("UPLOAD"),
  payload: z.object({ labelOriginal: z.unknown(), notesOriginal: z.unknown() }).strict(),
}).passthrough();
const ReplaceEnvelopeSchema = z.object({ action: z.literal("REPLACE") }).passthrough();

async function actor() {
  const current = await requireRole("BRAND");
  await checkOrganizationActor(current);
  return current;
}
function query(request: Request, allowed: readonly string[]): Record<string, string> {
  const entries = [...new URL(request.url).searchParams];
  if (new Set(entries.map(([key]) => key)).size !== entries.length
    || entries.some(([key]) => !allowed.includes(key))) throw new BrandContextError("VALIDATION", 422);
  return Object.fromEntries(entries);
}
function scopedQuery(request: Request) {
  const values = query(request, ["scope", "brandId", "clientId", "contextId", "versionId"]);
  const scope = values.scope === "OWN_BRAND" && values.brandId !== undefined && values.clientId === undefined
    ? { kind: "OWN_BRAND", brandId: values.brandId }
    : values.scope === "CLIENT" && values.clientId !== undefined && values.brandId === undefined
      ? { kind: "CLIENT", clientId: values.clientId } : null;
  if (!scope) throw new BrandContextError("VALIDATION", 422);
  const { scope: _scope, brandId: _brandId, clientId: _clientId, ...fields } = values;
  void _scope; void _brandId; void _clientId;
  return ContextReferenceQuerySchema.parse({ ...fields, scope });
}
function noQuery(request: Request) {
  if (new URL(request.url).search) throw new BrandContextError("VALIDATION", 422);
}
function requestAlive(request: Request) {
  if (request.signal.aborted) throw new EvidenceError("UPLOAD_ABORTED", 408);
}
function mediaType(value: string | null) {
  return value?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

// Count actual wire bytes even when Content-Length is absent or inaccurate.
// Cancellation is deliberately not awaited: a hostile producer's cancel hook
// cannot keep an aborted/timed-out response open.
async function boundedBody(request: Request, maximum: number): Promise<Uint8Array> {
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maximum))
    throw new EvidenceError("PAYLOAD_TOO_LARGE", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new EvidenceError("VALIDATION", 422);
  let failure: EvidenceError | undefined;
  let rejectBoundary!: (error: EvidenceError) => void;
  const interrupted = new Promise<never>((_resolve, reject) => { rejectBoundary = reject; });
  function interrupt(code: "UPLOAD_TIMEOUT" | "UPLOAD_ABORTED") {
    if (failure) return;
    failure = new EvidenceError(code, 408);
    rejectBoundary(failure);
    void reader!.cancel().catch(() => {});
  }
  const aborted = () => interrupt("UPLOAD_ABORTED");
  const deadline = setTimeout(() => interrupt("UPLOAD_TIMEOUT"), BODY_TIMEOUT_MS);
  request.signal.addEventListener("abort", aborted, { once: true });
  if (request.signal.aborted) aborted();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const part = await Promise.race([reader.read(), interrupted]);
      if (failure) throw failure;
      if (part.done) break;
      size += part.value.byteLength;
      if (size > maximum) {
        void reader.cancel().catch(() => {});
        throw new EvidenceError("PAYLOAD_TOO_LARGE", 413);
      }
      chunks.push(part.value);
    }
  } finally {
    clearTimeout(deadline); request.signal.removeEventListener("abort", aborted);
    try { reader.releaseLock(); } catch { /* Preserve the actual boundary failure. */ }
  }
  if (!size) throw new EvidenceError("VALIDATION", 422);
  return new Uint8Array(Buffer.concat(chunks, size));
}
function decodeJson(bytes: Uint8Array): unknown {
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new EvidenceError("VALIDATION", 422); }
}
async function uploadCommand(request: Request) {
  const wire = await boundedBody(request, UPLOAD_WIRE_BYTES);
  requestAlive(request);
  let form: FormData;
  try {
    // Parse only the already bounded bytes. Do not call formData() on the
    // unbounded incoming request. A JSON Blob preserves its original UTF-8 bytes.
    form = await new Request(request.url, { method: "POST",
      headers: { "Content-Type": request.headers.get("content-type")! },
      body: new Uint8Array(wire),
    }).formData();
  } catch { throw new EvidenceError("VALIDATION", 422); }
  requestAlive(request);
  const entries = [...form.entries()];
  if (entries.length !== 2 || new Set(entries.map(([key]) => key)).size !== 2
    || entries.some(([key]) => key !== "command" && key !== "file")) throw new EvidenceError("VALIDATION", 422);
  const metadata = form.get("command"), file = form.get("file");
  if (!(metadata instanceof File) || !(file instanceof File)
    || metadata.type !== "application/json" || !metadata.size || !file.size) throw new EvidenceError("VALIDATION", 422);
  if (metadata.size > METADATA_BYTES || file.size > MAX_EVIDENCE_BYTES) throw new EvidenceError("PAYLOAD_TOO_LARGE", 413);
  if (!FILE_TYPES.has(file.type)) throw new EvidenceError("INVALID_ASSET_FORMAT", 422);
  const envelope = UploadMetadataSchema.parse(decodeJson(new Uint8Array(await metadata.arrayBuffer())));
  requestAlive(request);
  const bytes = new Uint8Array(await file.arrayBuffer());
  requestAlive(request);
  // MIME is client-declared here; the native service's signature/checksum gate
  // remains authoritative. It does not establish malware scanning.
  return ContextReferenceCommandSchema.parse({ ...envelope,
    payload: { ...envelope.payload, contentType: file.type, bytes },
  });
}
async function replaceCommand(request: Request) {
  const envelope = ReplaceEnvelopeSchema.parse(decodeJson(await boundedBody(request, JSON_WIRE_BYTES)));
  requestAlive(request);
  return ContextReferenceCommandSchema.parse(envelope);
}

export const loadContextReferences = domainHandler(async (request: Request) => {
  const current = await actor();
  return getContextReferences(current, scopedQuery(request));
});
export const commandContextReferences = domainHandler(async (request: Request) => {
  const current = await actor(); noQuery(request);
  const type = mediaType(request.headers.get("content-type"));
  if (type === "multipart/form-data") {
    // Resolve genuine storage readiness before consuming a potentially large
    // body. The native command still owns current scope/plan/final authorization.
    const options = await evidenceOptionsForSession(current);
    return executeContextReferenceCommand(current, await uploadCommand(request), { storage: options.storage });
  }
  if (type !== "application/json") throw new EvidenceError("VALIDATION", 422);
  // Activation requires executeContextReferenceCommand's metadata-only REPLACE
  // overload/default options; this branch intentionally has no byte-storage gate.
  return executeContextReferenceCommand(current, await replaceCommand(request));
});
export const loadContextReferenceAsset = domainHandler(async (request: Request,
  context: { params: Promise<{ bindingId: string }> }) => {
  const current = await actor(), { bindingId } = await context.params;
  const input = ContextReferenceAssetQuerySchema.parse({ ...scopedQuery(request), bindingId });
  const options = await evidenceOptionsForSession(current);
  const file = await getContextReferenceAsset(current, input, { storage: options.storage });
  return new Response(new Uint8Array(file.bytes), { headers: file.headers });
});
export const loadContextReviewReferences = domainHandler(async (request: Request) => {
  const current = await actor();
  return getContextReviewReferences(current, ReviewQuerySchema.parse(query(request, ["submissionId"])));
});
export const loadContextReviewReferenceAsset = domainHandler(async (request: Request,
  context: { params: Promise<{ bindingId: string }> }) => {
  const current = await actor(), { bindingId } = await context.params;
  const input = ContextReviewReferenceAssetQuerySchema.parse({ ...query(request, ["submissionId"]), bindingId });
  const options = await evidenceOptionsForSession(current);
  const file = await getContextReviewReferenceAsset(current, input, { storage: options.storage });
  return new Response(new Uint8Array(file.bytes), { headers: file.headers });
});
export const loadCampaignReviewReferences = domainHandler(async (request: Request) => {
  const current = await actor();
  return getCampaignReviewReferences(current, ReviewQuerySchema.parse(query(request, ["submissionId"])));
});
export const loadCampaignReviewReferenceAsset = domainHandler(async (request: Request,
  context: { params: Promise<{ bindingId: string }> }) => {
  const current = await actor(), { bindingId } = await context.params;
  const input = ContextReviewReferenceAssetQuerySchema.parse({ ...query(request, ["submissionId"]), bindingId });
  const options = await evidenceOptionsForSession(current);
  const file = await getCampaignReviewReferenceAsset(current, input, { storage: options.storage });
  return new Response(new Uint8Array(file.bytes), { headers: file.headers });
});
