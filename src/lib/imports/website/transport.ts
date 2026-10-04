import { request } from "node:https";
import { connect, checkServerIdentity, type TLSSocket } from "node:tls";
import { isIP } from "node:net";
import type { ClientRequest, IncomingMessage } from "node:http";
import { isPublicAddress, sameAddress, validateWebsiteUrl } from "./destination";
import { WebsiteImportError, type WebsiteDependencies } from "./types";

/** Uses a fresh pinned TLS connection and verifies it before giving the socket
 * to HTTP. No global agent/fetch, proxy environment, cookie jar, redirects or
 * second hostname lookup. Instantiation alone never enables the capability. */
export function createPinnedHttpsTransport(reviewVersion: string): NonNullable<WebsiteDependencies["transport"]> {
  if (!/^[A-Za-z0-9_.:-]{1,100}$/.test(reviewVersion)) throw new WebsiteImportError("CAPABILITY_UNAVAILABLE");
  return { mode: "LIVE", reviewVersion, async get(input) {
    let origin: string;
    try { origin = new URL(input.url).origin; } catch { throw new WebsiteImportError("INVALID_URL"); }
    const url = validateWebsiteUrl(input.url, origin), address = input.destination;
    if (!address || isIP(address.address) !== address.family || !isPublicAddress(address.address)) throw new WebsiteImportError("DESTINATION_BLOCKED");
    if (!Number.isSafeInteger(input.maxResponseBytes) || input.maxResponseBytes < 1 || input.maxResponseBytes > 1_048_576
      || !Number.isFinite(input.deadline)) throw new WebsiteImportError("LIMIT_CONFIGURATION");
    const remainingTime = Math.min(20_000, input.deadline - performance.now());
    if (remainingTime <= 0 || input.signal.aborted) throw new WebsiteImportError("DEADLINE");
    return new Promise((resolve, reject) => {
      let socket: TLSSocket | undefined, outgoing: ClientRequest | undefined, incoming: IncomingMessage | undefined, settled = false;
      const timer = setTimeout(() => fail(new WebsiteImportError("DEADLINE")), remainingTime);
      const abort = () => fail(new WebsiteImportError("DEADLINE"));
      const cleanup = () => { clearTimeout(timer); input.signal.removeEventListener("abort", abort); };
      function fail(error: unknown) {
        if (settled) return;
        settled = true; cleanup();
        incoming?.destroy(); outgoing?.destroy(); socket?.destroy();
        reject(error instanceof WebsiteImportError ? error : new WebsiteImportError("TRANSPORT_FAILED"));
      }
      input.signal.addEventListener("abort", abort, { once: true });
      if (input.signal.aborted) { abort(); return; }
      try {
        socket = connect({ host: address.address, port: 443, servername: url.hostname,
          rejectUnauthorized: true, minVersion: "TLSv1.2", ALPNProtocols: ["http/1.1"],
          checkServerIdentity: (_name, certificate) => checkServerIdentity(url.hostname, certificate) });
        socket.on("error", fail);
        socket.once("secureConnect", () => {
          if (settled || !socket) return;
          if (!socket.authorized || checkServerIdentity(url.hostname, socket.getPeerCertificate())) { fail(new WebsiteImportError("TLS_REJECTED")); return; }
          if (!socket.remoteAddress || !isPublicAddress(socket.remoteAddress) || !sameAddress(socket.remoteAddress, address.address)) { fail(new WebsiteImportError("PEER_MISMATCH")); return; }
          const verifiedSocket = socket;
          try {
            outgoing = request({ protocol: "https:", hostname: url.hostname, port: 443, method: "GET", path: url.pathname,
              // With an explicit createConnection and no agent, Node v24 skips
              // the global agent. The only returned socket is already verified.
              createConnection: () => verifiedSocket, maxHeaderSize: 16_384, insecureHTTPParser: false,
              signal: input.signal, headers: { Host: url.hostname, Accept: "text/html, text/plain;q=0.9", "Accept-Encoding": "identity", "User-Agent": "InfameWebsiteImport/1.0", Connection: "close" } }, (response) => {
              incoming = response;
              const peer = response.socket.remoteAddress;
              if (!peer || !isPublicAddress(peer) || !sameAddress(peer, address.address)) { fail(new WebsiteImportError("PEER_MISMATCH")); return; }
              const declared = response.headers["content-length"], encoding = response.headers["content-encoding"];
              if (declared !== undefined && (!/^(0|[1-9][0-9]*)$/.test(declared) || BigInt(declared) > BigInt(input.maxResponseBytes))) { fail(new WebsiteImportError("RESPONSE_BYTE_LIMIT")); return; }
              if (encoding && encoding.trim().toLowerCase() !== "identity") { fail(new WebsiteImportError("UNSUPPORTED_RESPONSE")); return; }
              const chunks: Buffer[] = []; let bytes = 0;
              response.on("error", fail);
              response.on("aborted", () => fail(new WebsiteImportError("TRANSPORT_FAILED")));
              response.on("data", (chunk: Buffer) => {
                if (settled) return;
                if (!Buffer.isBuffer(chunk) || bytes + chunk.length > input.maxResponseBytes) { fail(new WebsiteImportError("RESPONSE_BYTE_LIMIT")); return; }
                try { input.consumeBytes?.(chunk.length); } catch (error) { fail(error); return; }
                bytes += chunk.length; chunks.push(chunk);
              });
              response.once("end", () => {
                if (settled) return;
                if (!response.complete || (declared !== undefined && BigInt(declared) !== BigInt(bytes))) { fail(new WebsiteImportError("TRANSPORT_FAILED")); return; }
                settled = true; cleanup();
                const headers: Record<string, string | undefined> = {};
                for (const key of ["content-type", "content-length", "content-encoding", "location"]) {
                  const value = response.headers[key];
                  if (typeof value === "string") headers[key] = value;
                }
                resolve({ status: response.statusCode ?? 0, headers, body: Buffer.concat(chunks, bytes), peerAddress: peer });
                verifiedSocket.destroy();
              });
            });
            outgoing.on("error", fail); outgoing.end();
          } catch (error) { fail(error); }
        });
      } catch (error) { fail(error); }
    });
  } };
}
