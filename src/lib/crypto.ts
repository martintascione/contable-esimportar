import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

/**
 * Cifrado simétrico AES-256-GCM para secrets guardados en la base.
 * Clave: APP_ENCRYPTION_KEY (32 bytes en hex, generar con `openssl rand -hex 32`).
 * Fallback: derivada de SUPABASE_SERVICE_ROLE_KEY para que funcione sin
 * configuración extra (recomendado igual definir APP_ENCRYPTION_KEY en Vercel).
 */
function key(): Buffer {
  const hex = process.env.APP_ENCRYPTION_KEY;
  if (hex && /^[0-9a-fA-F]{64}$/.test(hex)) return Buffer.from(hex, "hex");
  const seed = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!seed) throw new Error("Falta APP_ENCRYPTION_KEY (o SUPABASE_SERVICE_ROLE_KEY) para cifrar secrets.");
  return createHash("sha256").update("contable-ia:app-secrets:" + seed).digest();
}

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${enc.toString("base64url")}`;
}

export function decrypt(payload: string): string {
  const [v, ivB, tagB, encB] = payload.split(".");
  if (v !== "v1" || !ivB || !tagB || !encB) throw new Error("Formato de secret inválido");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encB, "base64url")), decipher.final()]).toString("utf8");
}

/** Enmascara un valor para mostrarlo en la UI: "sk-ant-…4f2a" */
export function mask(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.length <= 8) return "••••";
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

export function randomToken(bytes = 24) {
  return randomBytes(bytes).toString("base64url");
}
