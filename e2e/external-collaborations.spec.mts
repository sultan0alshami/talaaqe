import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { prisma as db } from "../src/lib/prisma";
import { openSession } from "../src/lib/identity";
import { SESSION_COOKIE } from "../src/lib/jwt";
import { taskState, assertLocalTarget } from "../scripts/task-state.mjs";
import { createLocalEvidenceStorage } from "../src/lib/evidence/storage";
const state = taskState(), users: string[] = [];
if (process.env.DATABASE_URL !== assertLocalTarget(state, "e2e")) throw new Error("Organizer E2E requires its task target");
test.use({ trace: "off", screenshot: "off", video: "off" });
test.afterEach(async () => {
  const assets = await db.privateAsset.findMany({ where: { ownerUserId: { in: users } } });
  await db.externalCollaborationCommand.deleteMany({ where: { actorUserId: { in: users } } });
  await db.externalCollaborationAttachment.deleteMany({ where: { ownerUserId: { in: users } } });
  await db.externalCollaboration.deleteMany({ where: { ownerUserId: { in: users } } });
  await db.privateAsset.deleteMany({ where: { ownerUserId: { in: users } } });
  const storage = await createLocalEvidenceStorage({ taskId: state.id, target: "e2e" });
  for (const asset of assets) await storage.remove(asset.storageKey.replace(/^local:/, ""));
  await db.adminAudit.deleteMany({ where: { actorUserId: { in: users } } });
  await db.outboxEvent.deleteMany({ where: { OR: users.map(actorUserId => ({ payload: { path: ["actorUserId"], equals: actorUserId } })) } });
  await db.user.deleteMany({ where: { id: { in: users } } }); users.length = 0;
});
test("creator organizes original content, checklist, private file and archive", async ({ page, context }, info) => {
  const en = info.project.name === "english-desktop", copy = (ar: string, english: string) => en ? english : ar;
  const id = randomUUID(); users.push(id);
  const user = await db.user.create({ data: { id, role: "CREATOR", active: true, isTest: true, name: "Synthetic organizer owner",
    email: id + "@example.invalid", passwordHash: "not-a-login", language: en ? "en" : "ar" } });
  const token = await openSession(id, user.sessionVersion, user.passwordHash);
  await context.addCookies([{ name: SESSION_COOKIE, value: token, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" },
    { name: "infame_lang", value: en ? "en" : "ar", domain: "localhost", path: "/" }]);
  await page.goto("/creator/collaborations");
  await page.getByLabel(copy("اسم العميل", "Client name"), { exact: true }).fill("عميل أصلي Original client");
  await page.getByLabel(copy("اسم الحملة", "Campaign name"), { exact: true }).fill("حملة اختبار Original campaign");
  await page.getByRole("button", { name: copy("إنشاء التعاون", "Create collaboration"), exact: true }).click();
  await expect(page).toHaveURL(/\/creator\/collaborations\/[^/]+$/);
  await page.getByLabel(copy("ملاحظات خاصة", "Private notes"), { exact: true }).fill("  ملاحظات أصلية\nPrivate notes  ");
  await page.getByLabel(copy("القيمة المعلنة (اختياري)", "Declared value (optional)"), { exact: true }).fill("1250.50");
  await page.getByRole("button", { name: copy("إضافة مهمة", "Add task"), exact: true }).click();
  await page.getByLabel(copy("المهمة", "Task") + " 1", { exact: true }).fill("تسليم المسودة");
  await page.getByRole("button", { name: copy("حفظ التعديلات", "Save changes"), exact: true }).click();
  await expect(page.getByRole("button", { name: copy("حفظ التعديلات", "Save changes"), exact: true })).toBeDisabled();
  const record = await db.externalCollaboration.findFirstOrThrow({ where: { ownerUserId: id } });
  expect(record.detailsJson).toMatchObject({ declaredValue: { amountMinor: "125050", currencyCode: "SAR" }, notes: { text: "  ملاحظات أصلية\nPrivate notes  " } });
  await page.getByLabel(copy("اختر ملفاً", "Choose file"), { exact: true }).setInputFiles({ name: "original.png", mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX1kAAAAASUVORK5CYII=", "base64") });
  await page.getByRole("button", { name: copy("رفع الملف", "Upload file"), exact: true }).click();
  await expect(page.getByRole("link", { name: "original.png", exact: true })).toBeVisible();
  await page.getByRole("button", { name: copy("أرشفة", "Archive"), exact: true }).click();
  await expect(page.getByRole("button", { name: copy("استعادة", "Restore"), exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
