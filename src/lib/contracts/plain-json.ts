import { z } from "zod";

export function plain(value: unknown, limit: number) {
  const walk = (item: unknown, depth: number): boolean => {
    if (depth > 12) return false;
    if (item === null || ["string", "boolean"].includes(typeof item)) return true;
    if (typeof item === "number") return Number.isFinite(item);
    if (typeof item !== "object") return false;
    if (Object.getPrototypeOf(item) !== (Array.isArray(item) ? Array.prototype : Object.prototype)) return false;
    if (Array.isArray(item) && item.length > limit) return false;
    const descriptors = Object.getOwnPropertyDescriptors(item);
    if (Reflect.ownKeys(descriptors).some(key => typeof key !== "string" || ["__proto__", "prototype", "constructor"].includes(key))) return false;
    if (Array.isArray(item) && Object.keys(descriptors).some(key => key !== "length"
      && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= item.length))) return false;
    if (Array.isArray(item) && Array.from({ length: item.length }, (_, i) => String(i)).some(key => !Object.hasOwn(descriptors, key))) return false;
    return Object.entries(descriptors).every(([key, descriptor]) => Array.isArray(item) && key === "length"
      ? true : "value" in descriptor && descriptor.enumerable && walk(descriptor.value, depth + 1));
  };
  try { return walk(value, 0) && new TextEncoder().encode(JSON.stringify(value)).byteLength <= limit; } catch { return false; }
}
function bounded<T extends z.ZodType>(schema: T, limit: number) {
  return z.unknown().superRefine((value, ctx) => {
    if (!plain(value, limit)) ctx.addIssue({ code: "custom", message: "Expected bounded plain JSON" });
  }).pipe(schema);
}
// Shared pure guard for the native planning declaration modules; no permission
// or provider capability is granted by constructing or passing this validator.
export const planningPlainJsonSchema = bounded;
