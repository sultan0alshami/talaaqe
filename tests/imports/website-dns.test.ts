import { describe, expect, it, vi, beforeEach } from "vitest";
const mocks = vi.hoisted(() => ({ resolve4: vi.fn(), resolve6: vi.fn(), cancel: vi.fn() }));
vi.mock("node:dns/promises", () => ({ Resolver: class {
  resolve4 = mocks.resolve4; resolve6 = mocks.resolve6; cancel = mocks.cancel;
} }));
import { createPublicDnsResolver, resolvePublicDestination } from "@/lib/imports/website/destination";
beforeEach(() => { mocks.resolve4.mockReset(); mocks.resolve6.mockReset(); mocks.cancel.mockReset(); });
describe("all-family native DNS query failure semantics using test-owned resolver", () => {
  it("accepts only ENODATA as an empty family and validates every available answer", async () => {
    mocks.resolve4.mockResolvedValue(["93.184.216.34"]); mocks.resolve6.mockRejectedValue({ code: "ENODATA" });
    expect(await resolvePublicDestination("brand.example.com", createPublicDnsResolver(), new AbortController().signal)).toEqual({ address: "93.184.216.34", family: 4 });
    expect(mocks.resolve4).toHaveBeenCalledWith("brand.example.com"); expect(mocks.resolve6).toHaveBeenCalledWith("brand.example.com");
    mocks.resolve6.mockResolvedValue(["fd00::1"]);
    await expect(resolvePublicDestination("brand.example.com", createPublicDnsResolver(), new AbortController().signal)).rejects.toMatchObject({ code: "DESTINATION_BLOCKED" });
  });
  it("blocks incomplete/inconsistent NXDOMAIN, timeouts and empty results without hiding the failed family", async () => {
    mocks.resolve4.mockResolvedValue(["93.184.216.34"]);
    for (const code of ["ENOTFOUND", "ETIMEOUT", "ECANCELLED", "ESERVFAIL"]) {
      mocks.resolve6.mockRejectedValue({ code });
      await expect(resolvePublicDestination("brand.example.com", createPublicDnsResolver(), new AbortController().signal)).rejects.toMatchObject({ code: "DESTINATION_BLOCKED" });
    }
    mocks.resolve4.mockRejectedValue({ code: "ENODATA" }); mocks.resolve6.mockRejectedValue({ code: "ENODATA" });
    await expect(resolvePublicDestination("brand.example.com", createPublicDnsResolver(), new AbortController().signal)).rejects.toMatchObject({ code: "DESTINATION_BLOCKED" });
  });
});
