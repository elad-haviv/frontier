/**
 * Encrypts the few secrets kept in settings, such as the AI provider key. The key comes from the
 * SECRETS_KEY variable and is never written to disk by Frontier.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { Encrypted } from "@frontier/schema";

export function encrypt(key: Buffer, text: string): Encrypted {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return {
    iv: iv.toString("base64"),
    data: data.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

/** The secret, or null when it cannot be read with this key. */
export function decrypt(key: Buffer, value: Encrypted): string | null {
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(value.iv, "base64"));
    decipher.setAuthTag(Buffer.from(value.tag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(value.data, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}
