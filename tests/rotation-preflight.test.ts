import { describe, expect, it } from "vitest";
import { assertOwnedRotationConfiguration } from "../scripts/rotation-preflight.mjs";
const expected = { AUTH_SECRET: "synthetic-rotation-unit-value", DATABASE_URL: "synthetic-no-database" };
const canonical = "AUTH_SECRET=synthetic-rotation-unit-value\nDATABASE_URL=synthetic-no-database\n";
describe("secret-free rotation configuration preflight", () => {
  it("accepts canonical task keys while preserving unrelated quoted and multiline settings", () => {
    expect(() => assertOwnedRotationConfiguration(canonical + "UNRELATED='kept value'\nNOTE=\"AUTH_SECRET=not-an-assignment\nexample\"\n", expected)).not.toThrow();
    expect(() => assertOwnedRotationConfiguration(canonical.replaceAll("\n", "\r\n"), expected)).not.toThrow();
  });
  it("rejects every alternate dotenv managed-key duplicate before any credential write", () => {
    for (const duplicate of ["AUTH_SECRET=another", "export AUTH_SECRET=another", " AUTH_SECRET=another", "AUTH_SECRET =another", "AUTH_SECRET: another", "export\nAUTH_SECRET=another", "auth_secret=another", "AUTH_SECRET='another'", 'AUTH_SECRET="another"']) {
      expect(() => assertOwnedRotationConfiguration(canonical + duplicate + "\n", expected), duplicate).toThrow("Owned configuration mismatch");
    }
  });
  it("binds canonical task values to their actual assignment rather than quoted multiline lookalikes", () => {
    for (const quote of ["'", '"', "`"]) {
      const note = `NOTE=${quote}unrelated\nAUTH_SECRET=synthetic-rotation-unit-value\nend${quote}\n`;
      const wrong = "AUTH_SECRET=synthetic-wrong\nDATABASE_URL=synthetic-no-database\n";
      expect(() => assertOwnedRotationConfiguration(note + wrong, expected)).toThrow("Owned configuration mismatch");
      expect(() => assertOwnedRotationConfiguration(wrong + note, expected)).toThrow("Owned configuration mismatch");
    }
  });
  it("rejects inner managed-key lines that would redirect the rotation updater away from the actual key", () => {
    // JS multiline anchors used by the updater also recognize lone CR and the
    // two Unicode line separators, even inside dotenv's quoted value.
    for (const separator of ["\n", "\r\n", "\r", "\u2028", "\u2029"]) {
      const note = `NOTE="unrelated${separator}AUTH_SECRET=synthetic-unrelated${separator}end"\n`;
      expect(() => assertOwnedRotationConfiguration(note + canonical, expected)).toThrow("Owned configuration mismatch");
      expect(() => assertOwnedRotationConfiguration(canonical + note, expected)).toThrow("Owned configuration mismatch");
    }
  });
});
