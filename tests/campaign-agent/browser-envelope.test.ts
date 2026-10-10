// One independent regression group for implemented helpers; no initial RED claim.
// Real Response/ReadableStream and WebCrypto shape; no native/browser proof.
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { readCampaignAgentResponse } from "@/lib/campaign-agent/browser-transport";
import { campaignAgentRecoveryKeyBinding } from "@/lib/campaign-agent/browser-storage";

const signal = () => new AbortController().signal;
function headers(id: string, extra: Record<string, string> = {}) {
  return { "Content-Type": "application/json; charset=UTF-8", "Cache-Control": "no-store, private", "X-Request-Id": id, ...extra };
}
function streamed(bytes: Uint8Array[], id: string, status = 200, extra: Record<string, string> = {}) {
  let index = 0, cancelled = false;
  const stream = new ReadableStream<Uint8Array>({ pull(controller) {
    if (index < bytes.length) controller.enqueue(bytes[index++]!); else controller.close();
  }, cancel() { cancelled = true; } });
  return { response: new Response(stream, { status, headers: headers(id, extra) }), cancelled: () => cancelled };
}
async function rejects(action: () => unknown | Promise<unknown>) {
  let failure: unknown = null; try { await action(); } catch (error: unknown) { failure = error; }
  // Never print a successful/rejected key DTO or unexpected secret message.
  expect(failure instanceof Error).toBe(true);
}

it("strictly bounds/authenticates streamed envelopes and key binding metadata, preserves UTF8, cancels excess/abort and never reads denied bodies", async () => {
  const encoder = new TextEncoder(), id = randomUUID(), data = { text: "  أصلية\nOriginal UTF8 كلمات  ", unknown: null };
  const envelope = { data, requestId: id }, bytes = encoder.encode(JSON.stringify(envelope));
  const multibyte = bytes.findIndex(byte => byte > 127); expect(multibyte).toBeGreaterThan(0);
  const split = streamed([bytes.slice(0, multibyte + 1), bytes.slice(multibyte + 1, multibyte + 3), bytes.slice(multibyte + 3)], id);
  expect(await readCampaignAgentResponse(split.response, signal(), 256)).toEqual(envelope);
  expect(split.cancelled()).toBe(false);
  const maximum = 256, exactData = "x".repeat(maximum - 2), exactPayload = { data: exactData, requestId: id };
  expect(encoder.encode(JSON.stringify(exactData)).byteLength).toBe(maximum);
  expect(await readCampaignAgentResponse(new Response(JSON.stringify(exactPayload), { headers: headers(id) }), signal(), maximum)).toEqual(exactPayload);
  await rejects(() => readCampaignAgentResponse(new Response(JSON.stringify({ data: exactData + "x", requestId: id }), { headers: headers(id) }), signal(), maximum));
  const wire = JSON.stringify({ data: "ok", requestId: id }), wireLimit = maximum + 1024;
  const exactWire = " ".repeat(wireLimit - encoder.encode(wire).byteLength) + wire;
  expect(encoder.encode(exactWire).byteLength).toBe(wireLimit);
  expect(await readCampaignAgentResponse(new Response(exactWire, { headers: headers(id) }), signal(), maximum)).toEqual({ data: "ok", requestId: id });
  const excessive = streamed([encoder.encode(exactWire + " "), encoder.encode("more unread bytes")], id);
  await rejects(() => readCampaignAgentResponse(excessive.response, signal(), maximum)); expect(excessive.cancelled()).toBe(true);
  const headerVariants: Record<string, string>[] = [{ "Cache-Control": "public, private, no-store" }, { "Cache-Control": "private" }, { "Cache-Control": "no-store" },
    { "Content-Type": "text/html" }, { "Content-Type": "application/json; charset=latin1" }, { "X-Request-Id": "not-a-request-id" }];
  for (const extra of headerVariants) {
    await rejects(() => readCampaignAgentResponse(new Response(wire, { headers: headers(id, extra) }), signal(), maximum));
  }
  for (const malformed of [{ data, requestId: randomUUID() }, { data, requestId: id, unknownAuthority: true },
    { requestId: id }, [data], null]) await rejects(() => readCampaignAgentResponse(new Response(JSON.stringify(malformed), { headers: headers(id) }), signal(), maximum));
  for (const limit of [0, -1, 1.5, 2097153, Number.POSITIVE_INFINITY]) await rejects(() => readCampaignAgentResponse(new Response(wire, { headers: headers(id) }), signal(), limit));
  const invalidUtf8 = streamed([new Uint8Array([0xc3, 0x28])], id);
  await rejects(() => readCampaignAgentResponse(invalidUtf8.response, signal(), maximum));
  const error = { error: { code: "RETRY_REQUIRED", message: "RETRY_REQUIRED", requestId: id, retryable: true }, requestId: id }, errorText = JSON.stringify(error);
  const exactErrorWire = " ".repeat(8192 - encoder.encode(errorText).byteLength) + errorText;
  expect(await readCampaignAgentResponse(new Response(exactErrorWire, { status: 503, headers: headers(id) }), signal(), maximum)).toEqual(error);
  const excessError = streamed([encoder.encode(exactErrorWire + " ")], id, 503);
  await rejects(() => readCampaignAgentResponse(excessError.response, signal(), maximum)); expect(excessError.cancelled()).toBe(true);
  for (const malformedError of [{ ...error, error: { ...error.error, retryable: false } },
    { ...error, error: { ...error.error, requestId: randomUUID() } }, { ...error, error: { ...error.error, message: "Synthetic raw error" } },
    { ...error, error: { ...error.error, extra: true } }]) await rejects(() => readCampaignAgentResponse(new Response(JSON.stringify(malformedError), { status: 503, headers: headers(id) }), signal(), maximum));
  for (const status of [401, 403, 404]) {
    let touched = false; const response = new Response("Synthetic malformed denied content", { status });
    Object.defineProperty(response, "body", { get() { touched = true; throw new Error("Denied stream read"); } });
    Object.defineProperty(response, "json", { value: async () => { touched = true; throw new Error("Denied JSON read"); } });
    await rejects(() => readCampaignAgentResponse(response, signal(), maximum)); expect(touched).toBe(false);
  }
  const aborted = new AbortController(); let cancelled = false, pulled!: () => void;
  const started = new Promise<void>(resolve => { pulled = resolve; });
  const pendingStream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(encoder.encode('{"data":')); },
    pull() { pulled(); return new Promise<void>(() => {}); }, cancel() { cancelled = true; } });
  const pending = readCampaignAgentResponse(new Response(pendingStream, { headers: headers(id) }), aborted.signal, maximum);
  void pending.catch(() => {}); await started; aborted.abort(); await rejects(() => pending); expect(cancelled).toBe(true);
  const preAborted = new AbortController(); preAborted.abort();
  await rejects(() => readCampaignAgentResponse(new Response(wire, { headers: headers(id) }), preAborted.signal, maximum));
  const keyBytes = crypto.getRandomValues(new Uint8Array(32)), keyId = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", keyBytes)), byte => byte.toString(16).padStart(2, "0")).join("");
  const binding = { scope: { kind: "OWN_BRAND" as const, brandId: "brand~envelope" }, workspaceId: "workspace~envelope", campaignId: "campaign~envelope" };
  const material = { schemaVersion: 1, asOf: "2026-10-08T12:34:56.000Z", binding, actorReference: "actor~envelope", algorithm: "AES-GCM", keyId, keyBase64Url: Buffer.from(keyBytes).toString("base64url") };
  const bound = campaignAgentRecoveryKeyBinding(material, material.actorReference, binding.scope, binding.campaignId);
  expect(JSON.stringify(bound) === JSON.stringify(binding)).toBe(true); expect("keyBase64Url" in bound || "keyId" in bound).toBe(false);
  for (const changed of [{ actorReference: "actor~foreign" }, { binding: { ...binding, campaignId: "campaign~foreign" } },
    { binding: { ...binding, scope: { kind: "CLIENT", clientId: "client~foreign" } } },
    { keyBase64Url: "malformed" }, { keyId: "invalid" }, { algorithm: "AES-CBC" }, { providerEnabled: true }]) {
    await rejects(() => campaignAgentRecoveryKeyBinding({ ...material, ...changed }, material.actorReference, binding.scope, binding.campaignId));
  }
  // This helper verifies bootstrap metadata only; the journal subsequently
  // validates raw-key SHA and current native authorization for save/restore.
});
