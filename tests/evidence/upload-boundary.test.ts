import { afterEach, expect, it, vi } from "vitest";
import { readEvidenceUpload } from "@/lib/evidence/transport";

afterEach(() => vi.useRealTimers());
function stalled(signal?: AbortSignal) {
  const cancelled = vi.fn();
  const body = new ReadableStream<Uint8Array>({ cancel: cancelled });
  const request = new Request("https://infame.example.invalid/api/evidence/assets", {
    method: "POST", body, signal, duplex: "half",
  } as RequestInit & { duplex: "half" });
  return { request, cancelled };
}
function outcome(request: Request) {
  return readEvidenceUpload(request).then(() => ({ code: "UNEXPECTED_SUCCESS" }), (error: unknown) => error);
}

it("cancels a stalled upload at the absolute twenty-second deadline", async () => {
  vi.useFakeTimers();
  const input = stalled(), result = outcome(input.request);
  await vi.advanceTimersByTimeAsync(20_001);
  expect(await Promise.race([result, Promise.resolve({ code: "STILL_PENDING" })])).toMatchObject({ code: "UPLOAD_TIMEOUT", status: 408 });
  expect(input.cancelled).toHaveBeenCalledOnce();
});
it("cancels pending byte reads when the request is aborted", async () => {
  vi.useFakeTimers();
  const abort = new AbortController(), input = stalled(abort.signal), result = outcome(input.request);
  abort.abort();
  await vi.advanceTimersByTimeAsync(1);
  expect(await Promise.race([result, Promise.resolve({ code: "STILL_PENDING" })])).toMatchObject({ code: "UPLOAD_ABORTED", status: 408 });
  expect(input.cancelled).toHaveBeenCalledOnce();
});
