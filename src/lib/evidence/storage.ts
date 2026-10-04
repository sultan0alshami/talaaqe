import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, realpath, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export class EvidenceError extends Error {
  constructor(public readonly code: string, public readonly status = 409) { super(code); this.name = "EvidenceError"; }
}
export const MAX_EVIDENCE_BYTES = 10 * 1024 * 1024;
export type EvidenceContentType = "image/png" | "image/jpeg" | "image/webp" | "application/pdf";
export type EvidenceStorage = {
  kind: "LOCAL" | "SUPABASE";
  put(key: string, bytes: Uint8Array, contentType: EvidenceContentType): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  remove(key: string): Promise<void>;
};
export const byteChecksum = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function keyParts(key: string) {
  if (!/^[A-Za-z0-9_-]{1,100}\/[A-Za-z0-9_-]{1,100}$/.test(key)) throw new EvidenceError("INVALID_STORAGE_KEY", 400);
  return key.split("/");
}
// A bounded signature gate is not malware scanning. Active PDF markers are
// excluded; all application downloads remain authenticated attachments.
export function inspectEvidence(bytes: Uint8Array, type: string): { contentType: EvidenceContentType; size: number; checksum: string } {
  if (!bytes.byteLength || bytes.byteLength > MAX_EVIDENCE_BYTES) throw new EvidenceError("INVALID_ASSET_SIZE", 413);
  const b = Buffer.from(bytes), ascii = b.toString("latin1");
  const valid = type === "image/png" ? b.length >= 24 && b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && b.toString("ascii", 12, 16) === "IHDR"
    : type === "image/jpeg" ? b.length >= 4 && b[0] === 255 && b[1] === 216 && b[2] === 255 && b[b.length - 2] === 255 && b[b.length - 1] === 217
      : type === "image/webp" ? b.length >= 20 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP" && ["VP8 ", "VP8L", "VP8X"].includes(b.toString("ascii", 12, 16)) && b.readUInt32LE(4) + 8 === b.length
        : type === "application/pdf" ? /^%PDF-1\.[0-9][\r\n]/.test(ascii) && /%%EOF\s*$/.test(ascii) && !/\/(JavaScript|JS|Launch|EmbeddedFile|RichMedia|OpenAction|AA)\b/i.test(ascii)
          : false;
  if (!valid) throw new EvidenceError("INVALID_ASSET_FORMAT", 400);
  return { contentType: type as EvidenceContentType, size: bytes.byteLength, checksum: byteChecksum(bytes) };
}
function storageFailure(error: unknown): never {
  if (error instanceof EvidenceError) throw error;
  throw new EvidenceError("ASSET_BYTES_UNAVAILABLE", 503);
}
export async function createLocalEvidenceStorage(options: { taskId: string; target: "dev" | "test" | "e2e" }): Promise<EvidenceStorage> {
  if (process.env.NODE_ENV === "production" || !/^infame_[a-f0-9]{12}$/.test(options.taskId) || options.taskId !== process.env.INFAME_TASK_ID || !["dev", "test", "e2e"].includes(options.target)) throw new EvidenceError("UNSAFE_LOCAL_STORAGE", 503);
  const workspace = await realpath(process.cwd());
  let task: { id?: string };
  try { task = JSON.parse(await readFile(path.join(workspace, ".infame", "task.json"), "utf8")); }
  catch { throw new EvidenceError("UNSAFE_LOCAL_STORAGE", 503); }
  if (task.id !== options.taskId) throw new EvidenceError("UNSAFE_LOCAL_STORAGE", 503);
  const root = path.join(workspace, ".infame", options.taskId, "evidence", options.target);
  async function safeDirectory(directory: string, create: boolean) {
    const relative = path.relative(workspace, directory);
    if (relative.startsWith("..") || path.isAbsolute(relative)) throw new EvidenceError("UNSAFE_LOCAL_STORAGE", 503);
    let current = workspace;
    for (const segment of relative.split(path.sep)) {
      current = path.join(current, segment);
      if (create) await mkdir(current, { recursive: false, mode: 0o700 }).catch(e => { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; });
      const stat = await lstat(current);
      if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(current) !== current) throw new EvidenceError("UNSAFE_LOCAL_STORAGE", 503);
    }
  }
  await safeDirectory(root, true);
  async function objectPath(key: string, create: boolean) {
    const parts = keyParts(key), directory = path.join(root, parts[0]!);
    await safeDirectory(directory, create);
    const filename = path.join(directory, parts[1]!);
    const stat = await lstat(filename).catch(e => { if ((e as NodeJS.ErrnoException).code === "ENOENT") return null; throw e; });
    if (stat?.isSymbolicLink() || stat?.isDirectory()) throw new EvidenceError("UNSAFE_LOCAL_STORAGE", 503);
    return filename;
  }
  return { kind: "LOCAL",
    async put(key, bytes, contentType) {
      inspectEvidence(bytes, contentType);
      try {
        const filename = await objectPath(key, true);
        try { await writeFile(filename, bytes, { flag: "wx", mode: 0o600 }); }
        catch (e) {
          if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
          if (byteChecksum(await readFile(filename)) !== byteChecksum(bytes)) throw new EvidenceError("STORAGE_CONFLICT");
        }
      } catch (e) { storageFailure(e); }
    },
    async get(key) {
      try { const filename = await objectPath(key, false), stat = await lstat(filename);
        if (stat.size > MAX_EVIDENCE_BYTES || !stat.isFile()) throw new EvidenceError("ASSET_BYTES_UNAVAILABLE", 503);
        return await readFile(filename);
      } catch (e) { return storageFailure(e); }
    },
    async remove(key) { try { await unlink(await objectPath(key, false)); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") storageFailure(e); } },
  };
}

export function createSupabaseEvidenceStorage(options: { url: string; serviceKey: string; bucket: string; transport?: typeof fetch }): EvidenceStorage {
  let origin: URL;
  try { origin = new URL(options.url); } catch { throw new EvidenceError("INVALID_STORAGE_CONFIGURATION", 503); }
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash || !options.serviceKey || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(options.bucket)) throw new EvidenceError("INVALID_STORAGE_CONFIGURATION", 503);
  const base = `${origin.origin}/storage/v1`, transport = options.transport ?? fetch;
  async function request(endpoint: string, init: RequestInit = {}) {
    try { return await transport(`${base}/${endpoint}`, { ...init, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000), headers: {
      Authorization: `Bearer ${options.serviceKey}`, apikey: options.serviceKey, ...Object.fromEntries(new Headers(init.headers).entries()),
    } }); } catch { throw new EvidenceError("ASSET_BYTES_UNAVAILABLE", 503); }
  }
  async function privateBucket() {
    const response = await request(`bucket/${options.bucket}`);
    if (!response.ok) throw new EvidenceError("ASSET_BYTES_UNAVAILABLE", 503);
    const metadata = await response.json().catch(() => null);
    if (metadata?.public !== false) throw new EvidenceError("PRIVATE_BUCKET_REQUIRED", 503);
  }
  async function download(key: string) {
    const response = await request(`object/authenticated/${options.bucket}/${key}`);
    if (!response.ok || !response.body) throw new EvidenceError("ASSET_BYTES_UNAVAILABLE", 503);
    const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
    try { for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength;
      if (size > MAX_EVIDENCE_BYTES) { await reader.cancel(); throw new EvidenceError("ASSET_BYTES_UNAVAILABLE", 503); } chunks.push(part.value); } }
    finally { reader.releaseLock(); }
    return Buffer.concat(chunks, size);
  }
  return { kind: "SUPABASE",
    async put(key, bytes, contentType) {
      keyParts(key); inspectEvidence(bytes, contentType); await privateBucket();
      const response = await request(`object/${options.bucket}/${key}`, { method: "POST", headers: { "Content-Type": contentType, "x-upsert": "false", "cache-control": "max-age=0" }, body: Buffer.from(bytes) });
      if (!response.ok) {
        if ((response.status === 400 || response.status === 409) && byteChecksum(await download(key)) === byteChecksum(bytes)) return;
        throw new EvidenceError(response.status === 400 || response.status === 409 ? "STORAGE_CONFLICT" : "ASSET_BYTES_UNAVAILABLE", response.status === 400 || response.status === 409 ? 409 : 503);
      }
    },
    async get(key) { keyParts(key); await privateBucket(); return download(key); },
    async remove(key) { keyParts(key); await privateBucket(); const response = await request(`object/${options.bucket}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prefixes: [key] }) }); if (!response.ok) throw new EvidenceError("ASSET_BYTES_UNAVAILABLE", 503); },
  };
}
