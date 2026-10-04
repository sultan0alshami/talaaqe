// Match dotenv's assignment grammar so alternate syntax cannot hide a duplicate
// managed key. Managed task configuration itself uses one canonical KEY=value.
// The additional d flag exposes the actual captured key's source range; the
// assignment body matches the installed dotenv grammar unchanged.
const assignment = /(?:^|^)\s*(?:export\s+)?([\w.-]+)(?:\s*=\s*?|:\s+?)(\s*'(?:\\'|[^'])*'|\s*"(?:\\"|[^"])*"|\s*`(?:\\`|[^`])*`|[^#\r\n]+)?\s*(?:#.*)?(?:$|$)/mgd;
export function assertOwnedRotationConfiguration(contents, expected) {
  const definitions = [...contents.matchAll(assignment)];
  for (const [key, value] of Object.entries(expected)) {
    const matches = definitions.filter((match) => match[1].toUpperCase() === key);
    const canonical = `${key}=${value}`;
    const match = matches[0];
    const start = match?.indices?.[1]?.[0];
    const end = typeof start === "number" ? start + canonical.length : -1;
    const actualCanonical = typeof start === "number"
      && (start === 0 || contents[start - 1] === "\n")
      && contents.slice(start, end) === canonical
      && (end === contents.length || contents[end] === "\n" || (contents[end] === "\r" && contents[end + 1] === "\n"))
      && (match[2] ?? "") === value;
    // The rotation updater uses /^KEY=.*$/m. A KEY= line inside an unrelated
    // quoted multiline value would also match that updater, so reject it.
    const updaterLines = contents.split(/\r\n|[\n\r\u2028\u2029]/).filter((line) => line.startsWith(`${key}=`));
    if (matches.length !== 1 || match[1] !== key || !actualCanonical || updaterLines.length !== 1) {
      throw Object.assign(new Error("Owned configuration mismatch"), { code: "OWNED_CONFIG_MISMATCH" });
    }
  }
}
