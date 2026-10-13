import { requireRole } from "@/lib/api";
import { domainHandler } from "@/lib/domain-api";
import { captureOrganizationActor } from "@/lib/organizations/context";
import { evidenceOptionsForSession } from "@/lib/evidence/runtime";
import { ExternalCollaborationError as ErrorCode, ExternalCollaborationCommandSchema, EXTERNAL_COLLABORATION_LIMITS as limits } from "./contracts";
import { executeExternalCollaborationCommand, getExternalCollaboration, listExternalCollaborations,
  attachExternalCollaborationFile, getExternalCollaborationFile } from "./service";

async function actor() { return captureOrganizationActor(await requireRole("CREATOR")); }
function query(request: Request, allowed: string[]) {
  const entries = [...new URL(request.url).searchParams];
  if (entries.some(([key]) => !allowed.includes(key)) || new Set(entries.map(([key]) => key)).size !== entries.length) throw new ErrorCode("VALIDATION", 422);
  return Object.fromEntries(entries);
}
function mediaType(request: Request) { return request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase(); }
function alive(request: Request) { if (request.signal.aborted) throw new ErrorCode("UPLOAD_ABORTED", 408); }
async function body(request: Request, maximum: number) {
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maximum)) throw new ErrorCode("PAYLOAD_TOO_LARGE", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new ErrorCode("VALIDATION", 422);
  let reject!: (error: ErrorCode) => void;
  const interrupted = new Promise<never>((_resolve, failure) => { reject = failure; });
  const stop = (code: string) => { reject(new ErrorCode(code, 408)); void reader.cancel().catch(() => {}); };
  const aborted = () => stop("UPLOAD_ABORTED");
  const timeout = setTimeout(() => stop("UPLOAD_TIMEOUT"), 20000);
  request.signal.addEventListener("abort", aborted, { once: true });
  if (request.signal.aborted) aborted();
  const chunks: Uint8Array[] = []; let count = 0;
  try {
    for (;;) {
      const part = await Promise.race([reader.read(), interrupted]);
      alive(request); if (part.done) break;
      count += part.value.byteLength;
      if (count > maximum) { void reader.cancel().catch(() => {}); throw new ErrorCode("PAYLOAD_TOO_LARGE", 413); }
      chunks.push(part.value);
    }
    return new Uint8Array(Buffer.concat(chunks, count));
  } finally { clearTimeout(timeout); request.signal.removeEventListener("abort", aborted); reader.releaseLock(); }
}
function json(bytes: Uint8Array) {
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new ErrorCode("VALIDATION", 422); }
}
export const loadExternalCollaborations = domainHandler(async (request: Request) => {
  const current = await actor(), values = query(request, ["archived", "after"]);
  if (values.archived !== undefined && !["true", "false"].includes(values.archived)) throw new ErrorCode("VALIDATION", 422);
  return listExternalCollaborations(current, { archived: values.archived === "true", ...(values.after !== undefined ? { after: values.after } : {}) });
});
export const commandExternalCollaboration = domainHandler(async (request: Request) => {
  const current = await actor(); query(request, []);
  if (mediaType(request) !== "application/json") throw new ErrorCode("VALIDATION", 422);
  const input = json(await body(request, limits.commandBytes)); alive(request);
  return executeExternalCollaborationCommand(current, input);
});
export const loadExternalCollaboration = domainHandler(async (request: Request, context: { params: Promise<{ id: string }> }) => {
  const current = await actor(); query(request, []);
  return getExternalCollaboration(current, { collaborationId: (await context.params).id });
});
export const uploadExternalCollaborationFile = domainHandler(async (request: Request, context: { params: Promise<{ id: string }> }) => {
  const current = await actor(); query(request, []);
  if (mediaType(request) !== "multipart/form-data") throw new ErrorCode("VALIDATION", 422);
  const options = await evidenceOptionsForSession(current), { id } = await context.params;
  const wire = await body(request, limits.attachmentBytes + limits.commandBytes + 16384);
  let form: FormData;
  try { form = await new Request(request.url, { method: "POST", headers: { "content-type": request.headers.get("content-type")! }, body: wire }).formData(); }
  catch { throw new ErrorCode("VALIDATION", 422); }
  alive(request);
  const entries = [...form.entries()], metadata = form.get("command"), file = form.get("file");
  if (entries.length !== 2 || entries.some(([key]) => !["command", "file"].includes(key))
    || !(metadata instanceof File) || !(file instanceof File) || metadata.type !== "application/json") throw new ErrorCode("VALIDATION", 422);
  if (metadata.size > limits.commandBytes || file.size > limits.attachmentBytes) throw new ErrorCode("PAYLOAD_TOO_LARGE", 413);
  const command = ExternalCollaborationCommandSchema.parse(json(new Uint8Array(await metadata.arrayBuffer())));
  if (command.action !== "ATTACH_FILE" || command.collaborationId !== id || command.payload.file.contentType !== file.type) throw new ErrorCode("VALIDATION", 422);
  const bytes = new Uint8Array(await file.arrayBuffer()); alive(request);
  return attachExternalCollaborationFile(current, command, bytes, { storage: options.storage });
});
export const downloadExternalCollaborationFile = domainHandler(async (request: Request, context: { params: Promise<{ id: string; attachmentId: string }> }) => {
  const current = await actor(); query(request, []);
  const { id, attachmentId } = await context.params, options = await evidenceOptionsForSession(current);
  const file = await getExternalCollaborationFile(current, { collaborationId: id, attachmentId }, { storage: options.storage });
  return new Response(new Uint8Array(file.bytes), { headers: file.headers });
});
