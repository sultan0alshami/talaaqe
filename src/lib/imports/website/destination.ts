import { isIP } from "node:net";
import { Resolver } from "node:dns/promises";
import { WebsiteImportError, type ResolvedAddress, type WebsiteDependencies } from "./types";

// IANA special-purpose registries checked 2026-10-04. Intentionally deny even
// globally reachable protocol-service exceptions: this adapter imports websites.
const IPV4_BLOCKS = ["0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8", "169.254.0.0/16", "172.16.0.0/12",
  "192.0.0.0/24", "192.0.2.0/24", "192.31.196.0/24", "192.52.193.0/24", "192.88.99.0/24", "192.168.0.0/16",
  "192.175.48.0/24", "198.18.0.0/15", "198.51.100.0/24", "203.0.113.0/24", "224.0.0.0/4", "240.0.0.0/4"];
const IPV6_BLOCKS = ["2001::/23", "2001:db8::/32", "2002::/16", "2620:4f:8000::/48", "3fff::/20"];
function ipNumber(address: string, family: number): bigint {
  if (family === 4) return address.split(".").reduce((value, part) => (value << BigInt(8)) | BigInt(part), BigInt(0));
  const halves = address.split("::"), left = halves[0] ? halves[0].split(":") : [], right = halves[1] ? halves[1].split(":") : [];
  const words = halves.length === 2 ? [...left, ...Array<string>(8 - left.length - right.length).fill("0"), ...right] : left;
  return words.reduce((value, part) => (value << BigInt(16)) | BigInt(`0x${part}`), BigInt(0));
}
function inBlock(value: bigint, block: string, family: number): boolean {
  const [base, width] = block.split("/"), shift = BigInt((family === 4 ? 32 : 128) - Number(width));
  return value >> shift === ipNumber(base, family) >> shift;
}
export function isPublicAddress(address: string): boolean {
  if (typeof address !== "string" || address.includes("%")) return false;
  const family = isIP(address);
  if (family === 4) return !IPV4_BLOCKS.some((block) => inBlock(ipNumber(address, 4), block, 4));
  // Global unicast only; this also excludes mapped/translated IPv4, multicast,
  // unique-local, link-local, unspecified, discard and future reserved space.
  if (family !== 6 || address.includes(".")) return false;
  const value = ipNumber(address, 6);
  return inBlock(value, "2000::/3", 6) && !IPV6_BLOCKS.some((block) => inBlock(value, block, 6));
}
export function sameAddress(left: string, right: string): boolean {
  const family = isIP(left);
  return family !== 0 && family === isIP(right) && !left.includes("%") && !right.includes("%")
    && (family === 4 || (!left.includes(".") && !right.includes("."))) && ipNumber(left, family) === ipNumber(right, family);
}
function checkedUrl(value: string): URL {
  const invalid = () => { throw new WebsiteImportError("INVALID_URL"); };
  if (typeof value !== "string" || value.length > 500 || !/^https:\/\//i.test(value) || /[\s\\\u0000-\u001f\u007f?#]/u.test(value)) return invalid();
  let url: URL;
  try { url = new URL(value); } catch { return invalid(); }
  const authority = value.slice(value.indexOf("//") + 2).split("/")[0];
  if (authority.includes("@") || url.protocol !== "https:" || url.port || url.username || url.password || url.search || url.hash) return invalid();
  const host = url.hostname;
  if (isIP(host) || host.startsWith("[") || host.endsWith(".") || !host.includes(".") || host.length > 253
    || host.split(".").some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
    || /(?:^|\.)(?:localhost|local|internal|lan|home|corp|onion|invalid|test|example|arpa)$/.test(host)) return invalid();
  let decoded = url.pathname;
  for (let round = 0; round < 8; round += 1) {
    if (/[\\\u0000-\u001f\u007f]/u.test(decoded)) return invalid();
    let next: string;
    try { next = decodeURIComponent(decoded); } catch { return invalid(); }
    if (next === decoded) return url;
    decoded = next;
  }
  return invalid();
}
export function validateWebsiteUrl(value: string, confirmedOrigin: string): URL {
  const origin = checkedUrl(confirmedOrigin);
  if (origin.origin !== confirmedOrigin || origin.pathname !== "/") throw new WebsiteImportError("INVALID_URL");
  const url = checkedUrl(value);
  if (url.origin !== confirmedOrigin) throw new WebsiteImportError("INVALID_URL");
  return url;
}
export async function resolvePublicDestination(hostname: string, resolver: NonNullable<WebsiteDependencies["resolver"]>, signal: AbortSignal): Promise<ResolvedAddress> {
  const answers = await resolver.resolve(hostname, signal);
  if (!Array.isArray(answers) || !answers.length || answers.length > 128
    || answers.some((answer) => !answer || isIP(answer.address) !== answer.family || !isPublicAddress(answer.address))) throw new WebsiteImportError("DESTINATION_BLOCKED");
  const selected = [...answers].sort((a, b) => a.family - b.family || (a.address < b.address ? -1 : a.address > b.address ? 1 : 0))[0];
  return { address: selected.address, family: selected.family === 4 ? 4 : 6 };
}
export function createPublicDnsResolver(): NonNullable<WebsiteDependencies["resolver"]> {
  return { async resolve(hostname, signal) {
    if (signal.aborted) throw new WebsiteImportError("DEADLINE");
    const resolver = new Resolver({ timeout: 5_000, tries: 1 });
    const cancel = () => resolver.cancel();
    signal.addEventListener("abort", cancel, { once: true });
    try {
      const results = await Promise.allSettled([resolver.resolve4(hostname), resolver.resolve6(hostname)]);
      const addresses: ResolvedAddress[] = [];
      for (let index = 0; index < results.length; index += 1) {
        const result = results[index];
        if (result.status === "rejected") {
          // ENOTFOUND is not an empty family. An inconsistent A/AAAA response
          // or any failed query must not hide a private answer in that family.
          if ((result.reason as { code?: string })?.code !== "ENODATA") throw new WebsiteImportError("DESTINATION_BLOCKED");
        } else {
          if (!Array.isArray(result.value) || result.value.length > 128) throw new WebsiteImportError("DESTINATION_BLOCKED");
          addresses.push(...result.value.map((address) => ({ address, family: index === 0 ? 4 as const : 6 as const })));
        }
      }
      return addresses;
    } finally { signal.removeEventListener("abort", cancel); resolver.cancel(); }
  } };
}
