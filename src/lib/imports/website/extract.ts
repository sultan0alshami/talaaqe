import { createHash } from "node:crypto";
import { WebsiteImportError, type WebsiteFact, type WebsitePage } from "./types";

export const WEBSITE_EXTRACTION_VERSION = "website-text-v1";
const BLOCKED = new Set(["script", "style", "noscript", "iframe", "object", "embed", "template", "svg", "math", "canvas", "form", "textarea"]);
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
function text(value: string, max: number): string {
  const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return value.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z]{2,8});/gi, (whole, key: string) => {
    if (!key.startsWith("#")) return entities[key.toLowerCase()] ?? whole;
    const point = key[1]?.toLowerCase() === "x" ? Number.parseInt(key.slice(2), 16) : Number.parseInt(key.slice(1), 10);
    return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : "";
  }).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/gu, "").replace(/\s+/gu, " ").trim().slice(0, max);
}
function attributes(value: string): Record<string, string> {
  const output: Record<string, string> = {};
  const matcher = /([a-z][a-z0-9_-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi;
  for (const match of value.matchAll(matcher)) {
    const name = match[1].toLowerCase();
    if ((name === "name" || name === "content") && !Object.hasOwn(output, name)) output[name] = match[2] ?? match[3] ?? match[4];
  }
  return output;
}
// A bounded text tokenizer, not a browser/DOM. It never evaluates scripts,
// follows links, loads assets, accepts JSON-LD instructions or runs a model.
export function extractWebsitePage(html: string, url: string, body: Buffer, retrievedAt: string, deadline = Infinity): WebsitePage {
  const lower = html.toLowerCase(), headings: string[] = [];
  let position = 0, tokens = 0, title = "", description = "", visible = "", capture = "", captureTag = "";
  while (position < html.length) {
    if (++tokens > 50_000 || performance.now() >= deadline) throw new WebsiteImportError("EXTRACTION_LIMIT");
    const opening = html.indexOf("<", position), endOfText = opening < 0 ? html.length : opening;
    const chunk = html.slice(position, endOfText);
    if (captureTag) capture = (capture + " " + chunk).slice(0, captureTag === "title" ? 2_000 : 1_000);
    visible = (visible + " " + chunk).slice(0, 12_000);
    if (opening < 0) break;
    if (html.startsWith("<!--", opening)) {
      const closing = html.indexOf("-->", opening + 4);
      if (closing < 0) break;
      position = closing + 3; continue;
    }
    let quote = "", ending = opening + 1;
    for (; ending < html.length && ending - opening < 16_384; ending += 1) {
      const character = html[ending];
      if (quote) { if (character === quote) quote = ""; }
      else if (character === '"' || character === "'") quote = character;
      else if (character === ">") break;
    }
    if (ending >= html.length || ending - opening >= 16_384) break;
    const token = html.slice(opening + 1, ending), match = /^\s*(\/?)\s*([a-z][a-z0-9:-]*)(?=[\s/]|$)/i.exec(token);
    position = ending + 1;
    if (!match) continue;
    const closing = match[1] === "/", name = match[2].toLowerCase();
    if (!closing && BLOCKED.has(name)) {
      if (VOID.has(name)) continue;
      let end = lower.indexOf(`</${name}`, position);
      while (end >= 0 && !/[\s/>]/.test(lower[end + name.length + 2] ?? "")) end = lower.indexOf(`</${name}`, end + 2);
      if (end < 0) break;
      const finish = html.indexOf(">", end);
      if (finish < 0) break;
      position = finish + 1; continue;
    }
    if (!closing && name === "meta" && !description) {
      const values = attributes(token.slice(match[0].length));
      if (values.name?.toLowerCase() === "description") description = text(values.content ?? "", 2_000);
    }
    if (!closing && (name === "title" || /^h[1-6]$/.test(name)) && !captureTag) { captureTag = name; capture = ""; }
    if (closing && name === captureTag) {
      const value = text(capture, name === "title" ? 200 : 200);
      if (name === "title" && !title) title = value;
      else if (value && headings.length < 20 && !headings.includes(value)) headings.push(value);
      captureTag = ""; capture = "";
    }
  }
  const bodyHash = createHash("sha256").update(body).digest("hex"), facts: WebsiteFact[] = [];
  const add = (fieldKey: WebsiteFact["fieldKey"], observedValue: string | string[]) => {
    if (!observedValue.length) return;
    facts.push({ fieldKey, observedValue, approvedValue: null, source: "PUBLIC_IMPORT", platform: null, unit: null, language: null,
      rawConfidence: .4, visibility: "PRIVATE", reviewStatus: "PROPOSED", evidenceAt: null, retrievedAt, sourceReference: url, sourceHash: bodyHash });
  };
  add("website.pageTitle", title); add("website.pageDescription", description);
  add("website.pageHeadings", headings); add("website.pageText", text(visible, 6_000));
  if (!facts.length) throw new WebsiteImportError("EXTRACTION_EMPTY");
  return { url, bodyHash, retrievedAt, facts };
}
