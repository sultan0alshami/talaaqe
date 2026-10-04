import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

// Inspect actual deployment manifests, never private task/configuration files.
const directory = path.resolve(process.env.NEXT_BUILD_DIR === ".next-e2e" ? ".next-e2e" : ".next");
const traces = [];
async function visit(current) {
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const filename = path.join(current, entry.name);
    if (entry.isDirectory()) await visit(filename);
    else if (entry.isFile() && entry.name.endsWith(".nft.json")) traces.push(filename);
  }
}
await visit(directory);
if (!traces.length) throw new Error("No deployment traces found");
let references = 0;
let rejected = 0;
for (const trace of traces) {
  const manifest = JSON.parse(await readFile(trace, "utf8"));
  if (!Array.isArray(manifest.files) || manifest.files.some((file) => typeof file !== "string")) throw new Error("Malformed deployment trace");
  for (const reference of manifest.files) {
    references++;
    const segments = path.resolve(path.dirname(trace), reference).split(/[\\/]/);
    if (segments.some((segment) => [".infame", ".research", ".git", ".pgdata"].includes(segment.toLowerCase()) || segment.toLowerCase().startsWith(".env"))) rejected++;
  }
}
// Only counts are emitted: a failed gate must not reveal a private file's path.
if (rejected) throw new Error(`Deployment traces include ${rejected} private development references`);
console.log(`Deployment privacy check passed: ${traces.length} manifests, ${references} references, zero private development references.`);
