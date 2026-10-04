import { describe, expect, it } from "vitest";
import { collectConfirmedWebsite } from "@/lib/imports/website";
import { createRobotsAccessPolicy, evaluateRobots } from "@/lib/imports/website/robots";
import type { WebsiteDependencies } from "@/lib/imports/website/types";

describe("explicit access approval and conservative robots policy", () => {
  it("supports groups, longest paths, equivalent allow, wildcard/end anchors and UTF-8 paths", () => {
    const rules = "User-agent: *\nDisallow: /private\nAllow: /private/open\nDisallow: /equal\nAllow: /equal\nDisallow: *.pdf$\nDisallow: /عربي\nUser-agent: InfameWebsiteImport\nDisallow: /only\nUser-agent: InfameWebsiteImport\nDisallow: /second";
    expect(evaluateRobots(rules, "/private")).toBe("ALLOW");
    expect(evaluateRobots(rules, "/only")).toBe("DENY"); expect(evaluateRobots(rules, "/second")).toBe("DENY");
    const wildcard = rules.split("User-agent: InfameWebsiteImport")[0];
    for (const path of ["/private", "/file.pdf", "/%D8%B9%D8%B1%D8%A8%D9%8A"]) expect(evaluateRobots(wildcard, path)).toBe("DENY");
    for (const path of ["/private/open", "/equal", "/file.pdf/more"]) expect(evaluateRobots(wildcard, path)).toBe("ALLOW");
    expect(evaluateRobots("", "/")).toBe("UNAVAILABLE"); expect(evaluateRobots("User-agent: other\nAllow: /", "/")).toBe("UNAVAILABLE");
  });
  it("never interprets missing/404/error robots as permission or accesses a page before approved rules", async () => {
    const input = { sourceId: "website", sourceRevision: 1, consentVersion: "test-v1", confirmedOrigin: "https://brand.example.com", confirmedUrl: "https://brand.example.com/" };
    for (const status of [404, 403, 500, 200]) {
      const visited: string[] = [], deps: WebsiteDependencies = { capability: { enabled: true, mode: "DEVELOPMENT_FIXTURE", reviewVersion: "synthetic-v1" },
        resolver: { resolve: async () => [{ address: "93.184.216.34", family: 4 }] },
        transport: { mode: "DEVELOPMENT_FIXTURE", reviewVersion: "synthetic-v1", get: async (request) => { visited.push(request.url); return { status, headers: { "content-type": "text/plain" }, body: Buffer.alloc(0), peerAddress: "93.184.216.34" }; } },
        accessPolicy: createRobotsAccessPolicy({ reviewVersion: "synthetic-policy-v1", approveAccess: async () => "ALLOW" }) };
      expect((await collectConfirmedWebsite(input, deps)).status).toBe("FAILED");
      expect(visited).toEqual([`${input.confirmedOrigin}/robots.txt`]);
    }
  });
  it("distinguishes literal URL wildcard/end characters from robots operators", () => {
    expect(evaluateRobots("User-agent: *\nDisallow: /file%2A.html", "/file*.html")).toBe("DENY");
    expect(evaluateRobots("User-agent: *\nDisallow: /price%24", "/price$")).toBe("DENY");
    expect(evaluateRobots("User-agent: *\nDisallow: /file*.html$", "/file-long.html")).toBe("DENY");
  });
});
