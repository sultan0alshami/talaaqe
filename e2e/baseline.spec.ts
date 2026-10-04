// Inherited startup/authorization harness; replace with canonical Infame journeys per phase.
import { test, expect } from "@playwright/test";
test("Arabic first paint and instant English interface toggle", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await page.getByRole("button", { name: "Switch to English", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
});
test("anonymous requests cannot read role data", async ({ page, request }) => {
  await page.goto("/provider");
  await expect(page).toHaveURL(/\/login(?:\?|$)/);
  expect((await request.get("/api/me")).status()).toBe(401);
  expect((await request.get("/api/projects")).status()).toBe(401);
});
