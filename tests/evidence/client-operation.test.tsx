// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { evidenceRead, useEvidenceOperation } from "@/components/infame/evidence-client";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const response = (data: unknown, status = 200) => new Response(JSON.stringify(status === 200 ? { data } : { error: { code: data } }), { status });
const latch = () => { let release!: () => void; return { promise: new Promise<void>(r => { release = r; }), release: () => release() }; };

it("retains an uncertain command's exact body/key and prevents another mutation until the identical replay succeeds", async () => {
  const fetch = vi.fn().mockRejectedValueOnce(new Error("lost response")).mockResolvedValueOnce(response({ revision: 2 }));
  vi.stubGlobal("fetch", fetch);
  const refresh = vi.fn(async () => {}), accepted = vi.fn(), fields = { expectedRevision: 1, note: { text: "أصلي", language: "ar" } };
  const { result } = renderHook(() => useEvidenceOperation(refresh));
  await act(() => result.current.command("BUSINESS_REVIEW", fields, "synthetic-review", accepted));
  expect(result.current).toMatchObject({ error: "NETWORK", pending: true, blocked: true, notice: false });
  await act(() => result.current.command("BUSINESS_REVIEW", { expectedRevision: 2 }, "other"));
  expect(fetch).toHaveBeenCalledTimes(1); expect(refresh).not.toHaveBeenCalled(); expect(accepted).not.toHaveBeenCalled();
  fields.note.text = "changed after send";
  await act(() => result.current.retry());
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls[0]).toEqual(fetch.mock.calls[1]);
  expect(JSON.parse(fetch.mock.calls[1][1].body).command).toMatchObject({ note: { text: "أصلي" }, expectedRevision: 1, operationKey: expect.any(String) });
  expect(accepted).toHaveBeenCalledOnce(); expect(refresh).toHaveBeenCalledOnce();
  expect(result.current).toMatchObject({ error: null, pending: false, blocked: false, notice: true });
});

it("prevents double submit during a genuine pending response and withholds success while authoritative reload is pending", async () => {
  const held = latch(), refreshing = latch(), fetch = vi.fn(async () => { await held.promise; return response({ revision: 2 }); });
  vi.stubGlobal("fetch", fetch);
  const accepted = vi.fn(), refresh = vi.fn(async () => { await refreshing.promise; }), { result } = renderHook(() => useEvidenceOperation(refresh));
  let first!: Promise<void>;
  act(() => { first = result.current.command("BUSINESS_REVIEW", { expectedRevision: 1 }, "synthetic-review", accepted); });
  expect(result.current).toMatchObject({ busy: true, blocked: true, notice: false });
  await act(() => result.current.command("BUSINESS_REVIEW", { expectedRevision: 1 }, "synthetic-review"));
  expect(fetch).toHaveBeenCalledTimes(1);
  await act(async () => { held.release(); await new Promise(r => setTimeout(r, 0)); });
  expect(refresh).toHaveBeenCalledOnce(); expect(result.current).toMatchObject({ busy: true, refreshRequired: true, notice: false });
  expect(accepted).not.toHaveBeenCalled();
  await act(async () => { refreshing.release(); await first; });
  expect(result.current).toMatchObject({ busy: false, refreshRequired: false, notice: true });
  expect(accepted).toHaveBeenCalledOnce();
});

it("keeps a committed result blocked if reload fails, then permits a fresh operation only after manual authoritative refresh", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ revision: 2 })));
  const refresh = vi.fn().mockRejectedValueOnce(new Error("load failed")).mockResolvedValueOnce(undefined);
  const accepted = vi.fn(), { result } = renderHook(() => useEvidenceOperation(refresh));
  await act(() => result.current.command("BUSINESS_REVIEW", { expectedRevision: 1 }, "synthetic-review", accepted));
  expect(result.current).toMatchObject({ pending: false, refreshRequired: true, blocked: true, error: "REFRESH_REQUIRED", notice: false });
  expect(accepted).not.toHaveBeenCalled();
  await act(() => result.current.command("BUSINESS_REVIEW", { expectedRevision: 1 }, "synthetic-review"));
  expect(refresh).toHaveBeenCalledTimes(1);
  await act(() => result.current.refresh());
  expect(result.current).toMatchObject({ refreshRequired: false, blocked: false, error: null });
  expect(accepted).toHaveBeenCalledOnce();
});

it.each(["STALE_VERSION", "UNAUTHENTICATED", "CAPABILITY_UNAVAILABLE"])("retains form ownership while a definitive %s response cannot show success", async code => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(code, code === "CAPABILITY_UNAVAILABLE" ? 503 : code === "UNAUTHENTICATED" ? 401 : 409)));
  const accepted = vi.fn(), refresh = vi.fn(async () => {}), { result } = renderHook(() => useEvidenceOperation(refresh));
  await act(() => result.current.command("BUSINESS_REVIEW", { expectedRevision: 1 }, "synthetic-review", accepted));
  expect(result.current).toMatchObject({ error: code, pending: false, notice: false });
  expect(accepted).not.toHaveBeenCalled(); expect(refresh).not.toHaveBeenCalled();
});

it("replays the same captured upload bytes/purpose/key without reacquiring the file", async () => {
  const bytes = new Uint8Array([1, 2, 3]), arrayBuffer = vi.fn(async () => bytes.buffer.slice(0));
  const file = { size: 3, type: "image/png", arrayBuffer } as unknown as File;
  const fetch = vi.fn().mockRejectedValueOnce(new Error("lost upload response")).mockResolvedValueOnce(response({ asset: { id: "captured" }, replayed: true }));
  vi.stubGlobal("fetch", fetch);
  const accepted = vi.fn(), { result } = renderHook(() => useEvidenceOperation(async () => {}));
  await act(() => result.current.upload(file, "SCREENSHOT", accepted));
  bytes.fill(9);
  await act(() => result.current.retry());
  expect(arrayBuffer).toHaveBeenCalledOnce(); expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls[0]).toEqual(fetch.mock.calls[1]);
  expect([...fetch.mock.calls[1][1].body]).toEqual([1, 2, 3]);
  expect(fetch.mock.calls[1][1].headers).toMatchObject({ "x-evidence-purpose": "SCREENSHOT", "x-operation-key": expect.any(String) });
  expect(accepted).toHaveBeenCalledOnce();
});

it("uses private no-store reads and returns the actual response's data", async () => {
  const fetch = vi.fn().mockResolvedValue(response({ entries: [] })); vi.stubGlobal("fetch", fetch);
  expect(await evidenceRead("/api/evidence/reviews?kind=OWNERSHIP")).toEqual({ entries: [] });
  expect(fetch.mock.calls[0][1]).toMatchObject({ cache: "no-store" });
});
