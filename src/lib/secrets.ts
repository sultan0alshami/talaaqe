// At-rest encryption for admin-entered secrets (AI provider API keys).
// AES-256-GCM with a key derived from AUTH_SECRET, so the database alone
// never contains usable credentials. Server-only (node:crypto).
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const PREFIX = "enc.v1.";

function encryptionKey(): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET must be set to store API keys");
  return createHash("sha256").update(secret).digest();
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return PREFIX + [iv, cipher.getAuthTag(), ciphertext].map((b) => b.toString("base64url")).join(".");
}

/** Returns null when the value can't be decrypted (e.g. AUTH_SECRET rotated). */
export function decryptSecret(stored: string): string | null {
  if (!stored.startsWith(PREFIX)) return stored; // tolerate legacy plaintext
  try {
    const [iv, tag, data] = stored.slice(PREFIX.length).split(".");
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** "sk-ant-…cdef" → "••••cdef" — safe to show in the admin UI. */
export function maskSecret(plain: string): string {
  return plain.length <= 4 ? "••••" : `••••${plain.slice(-4)}`;
}
