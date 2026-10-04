import { decodePublicText } from "./index";
import { WebsiteImportError, type AccessRequest, type WebsiteDependencies } from "./types";

const PRODUCT = "InfameWebsiteImport";
type Rule = { allow: boolean; path: string };
type Group = { agents: string[]; rules: Rule[] };
function octets(value: string): string {
  return Array.from(value).map((character) => character.charCodeAt(0) > 127 ? encodeURIComponent(character) : character).join("")
    .replace(/%[0-9a-f]{2}/gi, (encoded) => { const decoded = String.fromCharCode(Number.parseInt(encoded.slice(1), 16)); return /^[A-Za-z0-9._~-]$/.test(decoded) ? decoded : encoded.toUpperCase(); });
}
function matches(pattern: string, path: string): boolean {
  const exact = pattern.endsWith("$"), value = exact ? pattern.slice(0, -1) : pattern;
  let p = 0, s = 0, star = -1, retry = 0;
  while (s < path.length) {
    if (p === value.length && !exact) return true;
    if (value[p] === path[s]) { p += 1; s += 1; }
    else if (value[p] === "*") { star = p++; retry = s; }
    else if (star >= 0) { p = star + 1; s = ++retry; }
    else return false;
  }
  while (value[p] === "*") p += 1;
  return p === value.length;
}
// Conservative RFC9309 subset: an explicit applicable group in a successful
// UTF-8 robots file is required. Missing/404/network rules never silently allow.
export function evaluateRobots(body: string, path: string, deadline = Infinity): "ALLOW" | "DENY" | "UNAVAILABLE" {
  if (Buffer.byteLength(body) > 1_048_576 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(body)) return "UNAVAILABLE";
  const lines = body.replace(/^\uFEFF/, "").split(/\r?\n/);
  if (lines.length > 10_000) return "UNAVAILABLE";
  const groups: Group[] = []; let group: Group | undefined, rulesStarted = false;
  for (const raw of lines) {
    if (performance.now() >= deadline) throw new WebsiteImportError("DEADLINE");
    const line = raw.split("#")[0].trim();
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase(), value = line.slice(colon + 1).trim();
    if (key === "user-agent") {
      if (!/^(?:\*|[A-Za-z_-]+)$/.test(value)) return "UNAVAILABLE";
      if (!group || rulesStarted) { group = { agents: [], rules: [] }; groups.push(group); rulesStarted = false; }
      group.agents.push(value.toLowerCase());
    } else if ((key === "allow" || key === "disallow") && group) {
      rulesStarted = true;
      if (!value) continue;
      if (value.length > 500 || !(value.startsWith("/") || value.startsWith("*"))) return "UNAVAILABLE";
      group.rules.push({ allow: key === "allow", path: octets(value) });
    }
  }
  let applicable = groups.filter((entry) => entry.agents.includes(PRODUCT.toLowerCase()));
  if (!applicable.length) applicable = groups.filter((entry) => entry.agents.includes("*"));
  if (!applicable.length) return "UNAVAILABLE";
  // A literal * or $ in the URI is data, unlike robots pattern operators.
  // RFC9309 section 2.2.3 requires their percent-encoded comparison form.
  const target = octets(path).replace(/\*/g, "%2A").replace(/\$/g, "%24");
  let winning: Rule | undefined;
  for (const rule of applicable.flatMap((entry) => entry.rules)) {
    if (performance.now() >= deadline) throw new WebsiteImportError("DEADLINE");
    if (matches(rule.path, target) && (!winning || rule.path.length > winning.path.length || (rule.path.length === winning.path.length && rule.allow))) winning = rule;
  }
  return !winning || winning.allow ? "ALLOW" : "DENY";
}
export function createRobotsAccessPolicy(configuration: {
  reviewVersion: string;
  approveAccess(request: AccessRequest): Promise<"ALLOW" | "DENY" | "UNAVAILABLE">;
  clock?: () => Date;
}): NonNullable<WebsiteDependencies["accessPolicy"]> {
  if (!/^[A-Za-z0-9_.:-]{1,100}$/.test(configuration.reviewVersion) || typeof configuration.approveAccess !== "function") throw new WebsiteImportError("CAPABILITY_UNAVAILABLE");
  return { reviewVersion: configuration.reviewVersion, async check(input) {
    const access = await configuration.approveAccess(input);
    let robots: "ALLOW" | "DENY" | "UNAVAILABLE" = "UNAVAILABLE";
    if (access === "ALLOW") {
      if (input.purpose === "ROBOTS") robots = "ALLOW"; // separately approved retrieval of crawl rules
      else if (input.loadRobots) {
        const response = await input.loadRobots();
        robots = evaluateRobots(decodePublicText(response, "ROBOTS"), new URL(input.url).pathname, input.deadline);
      }
    }
    return { url: input.url, sourceId: input.sourceId, sourceRevision: input.sourceRevision, consentVersion: input.consentVersion,
      policyVersion: configuration.reviewVersion, checkedAt: (configuration.clock?.() ?? new Date()).toISOString(), access, robots };
  } };
}
