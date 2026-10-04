import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { AuthenticationInvalidated, SignupSchema, signup, authenticate, openSession, resolveSession, issueToken, consumeToken } from "@/lib/identity";

const createdUsers: string[] = [];
const strongPassword = "Correct horse 9 battery!";
afterAll(async () => {
  // Profile ownership uses SET NULL: delete only this file's synthetic profiles
  // before their Users so successful acceptance does not leave orphan rows.
  await prisma.creator.deleteMany({ where: { userId: { in: createdUsers } } });
  await prisma.brand.deleteMany({ where: { userId: { in: createdUsers } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUsers } } });
});

describe("revocable Infame identity", () => {
  it("rejects admin self-signup, weak or bcrypt-truncated passwords and invalid countries", () => {
    const base = { name: "اختبار", email: "identity@example.invalid", password: strongPassword, role: "CREATOR", countryCode: "EG", timeZone: "Africa/Cairo" };
    expect(SignupSchema.safeParse(base).success).toBe(true);
    for (const invalid of [{ ...base, role: "ADMIN" }, { ...base, password: "123456" }, { ...base, password: "ع".repeat(40) }, { ...base, countryCode: "ZZ" }]) expect(SignupSchema.safeParse(invalid).success).toBe(false);
  });
  it("creates a private canonical profile and immediately rejects suspended and version-revoked sessions", async () => {
    const email = `identity-${randomBytes(8).toString("hex")}@example.invalid`;
    const user = await signup({ name: "Synthetic identity", email, password: strongPassword, role: "CREATOR", countryCode: "EG", timeZone: "Africa/Cairo" });
    createdUsers.push(user.id);
    const creator = await prisma.creator.findUniqueOrThrow({ where: { userId: user.id } });
    expect(creator.state).toBe("DRAFT");
    expect(user.emailVerifiedAt).toBeNull();
    expect(await authenticate(email, "incorrect")).toBeNull();
    expect((await authenticate(email.toUpperCase(), strongPassword))?.id).toBe(user.id);
    const token = await openSession(user.id, user.sessionVersion, user.passwordHash);
    expect((await resolveSession(token))?.userId).toBe(user.id);
    await prisma.user.update({ where: { id: user.id }, data: { active: false } });
    expect(await resolveSession(token)).toBeNull();
    await prisma.user.update({ where: { id: user.id }, data: { active: true, sessionVersion: { increment: 1 } } });
    expect(await resolveSession(token)).toBeNull();
  });
  it("hashes verification tokens and permits only one concurrent consumption", async () => {
    const email = `identity-${randomBytes(8).toString("hex")}@example.invalid`;
    const user = await signup({ name: "Synthetic token", email, password: strongPassword, role: "BRAND" });
    createdUsers.push(user.id);
    const token = await issueToken(user.id, "VERIFY_EMAIL");
    const stored = await prisma.authToken.findUniqueOrThrow({ where: { id: token.id } });
    expect(stored.tokenHash).not.toContain(token.value);
    const results = await Promise.all([consumeToken("VERIFY_EMAIL", token.value), consumeToken("VERIFY_EMAIL", token.value)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerifiedAt).not.toBeNull();
    expect(await consumeToken("VERIFY_EMAIL", token.value)).toBeNull();
  });
  it("rejects expired tokens and reset replay, and revokes pre-reset sessions", async () => {
    const email = `identity-${randomBytes(8).toString("hex")}@example.invalid`;
    const user = await signup({ name: "Synthetic reset", email, password: strongPassword, role: "CREATOR" });
    createdUsers.push(user.id);
    const expired = await issueToken(user.id, "VERIFY_EMAIL");
    await prisma.authToken.update({ where: { id: expired.id }, data: { expiresAt: new Date(0) } });
    expect(await consumeToken("VERIFY_EMAIL", expired.value)).toBeNull();
    const session = await openSession(user.id, user.sessionVersion, user.passwordHash);
    const reset = await issueToken(user.id, "RESET_PASSWORD");
    const password = "A new correct password 99";
    expect(await consumeToken("RESET_PASSWORD", reset.value, password)).toBe(user.id);
    expect(await resolveSession(session)).toBeNull();
    expect(await authenticate(email, strongPassword)).toBeNull();
    expect((await authenticate(email, password))?.id).toBe(user.id);
    expect(await consumeToken("RESET_PASSWORD", reset.value, password)).toBeNull();
  });
  it("never upgrades stale password authentication to a post-reset session", async () => {
    const email = `identity-${randomBytes(8).toString("hex")}@example.invalid`;
    const user = await signup({ name: "Synthetic login race", email, password: strongPassword, role: "CREATOR" });
    createdUsers.push(user.id);
    const authenticated = await authenticate(email, strongPassword);
    expect(authenticated).not.toBeNull();
    const reset = await issueToken(user.id, "RESET_PASSWORD");
    await consumeToken("RESET_PASSWORD", reset.value, "Replacement password 4567");
    let rejected = false;
    try { await openSession(user.id, authenticated!.sessionVersion, authenticated!.passwordHash); }
    catch (error) { rejected = error instanceof Error && error.message === "Authentication invalidated"; }
    expect(rejected).toBe(true);
  });
  it.each(["version", "destination"] as const)("binds token issuance to the caller's captured %s before creating any credential", async changed => {
    const user = await signup({ name: "Synthetic captured issuance", email: `identity-${randomBytes(8).toString("hex")}@example.invalid`, password: strongPassword, role: "CREATOR" });
    createdUsers.push(user.id);
    const expected = { sessionVersion: user.sessionVersion, email: user.email };
    await prisma.user.update({ where: { id: user.id }, data: changed === "version"
      ? { sessionVersion: { increment: 1 } }
      : { email: `identity-${randomBytes(8).toString("hex")}@example.invalid` } });
    let invalidated = false;
    try { await issueToken(user.id, "VERIFY_EMAIL", expected); }
    catch (error) { invalidated = error instanceof AuthenticationInvalidated; }
    expect(invalidated).toBe(true);
    expect(await prisma.authToken.count({ where: { userId: user.id } })).toBe(0);
    const current = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    const valid = await issueToken(user.id, "VERIFY_EMAIL", { sessionVersion: current.sessionVersion, email: current.email });
    expect(await consumeToken("VERIFY_EMAIL", valid.value)).toBe(user.id);
  });
});
