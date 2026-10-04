import { describe, expect, it, vi } from "vitest";

const { projectCreator } = vi.hoisted(() => ({ projectCreator: vi.fn() }));
vi.mock("@/lib/onboarding/profiles", () => ({ publicCreator: projectCreator }));
vi.mock("@/components/infame/public-portfolio", () => ({ PublicPortfolio: () => null }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));
import Page, { generateMetadata } from "@/app/(public)/[handle]/page";

const creator = { handle: "synthetic_creator", displayName: "Synthetic original name" };
describe("public creator route segment boundary", () => {
  it.each(["@synthetic_creator", "%40synthetic_creator"])("loads the canonical public projection for Next segment %s", async handle => {
    projectCreator.mockReset().mockResolvedValue(creator);
    await expect(Page({ params: Promise.resolve({ handle }) })).resolves.toBeDefined();
    expect(projectCreator).toHaveBeenCalledWith("synthetic_creator");
  });
  it.each(["@synthetic_creator", "%40synthetic_creator"])("uses the same canonical handle in metadata for %s", async handle => {
    projectCreator.mockReset().mockResolvedValue(creator);
    expect(await generateMetadata({ params: Promise.resolve({ handle }) })).toMatchObject({ title: expect.stringContaining(creator.displayName), alternates: { canonical: "https://infame.sa/@synthetic_creator" } });
    expect(projectCreator).toHaveBeenCalledWith("synthetic_creator");
  });
  it.each(["synthetic_creator", "%2540synthetic_creator", "%40synthetic%2Fcreator", "%40ab", "%ZZ", "@admin", "@@synthetic_creator", "%40%20synthetic_creator"])("rejects malformed, unprefixed or reserved segment %s before projection", async handle => {
    projectCreator.mockReset();
    await expect(Page({ params: Promise.resolve({ handle }) })).rejects.toThrow("NOT_FOUND");
    expect(await generateMetadata({ params: Promise.resolve({ handle }) })).toMatchObject({ robots: { index: false, follow: false } });
    expect(projectCreator).not.toHaveBeenCalled();
  });
  it("withdraws identity and metadata when the canonical proof projection is unavailable", async () => {
    projectCreator.mockReset().mockResolvedValue(null);
    await expect(Page({ params: Promise.resolve({ handle: "%40synthetic_creator" }) })).rejects.toThrow("NOT_FOUND");
    expect(await generateMetadata({ params: Promise.resolve({ handle: "@synthetic_creator" }) })).toMatchObject({ robots: { index: false, follow: false } });
  });
});
