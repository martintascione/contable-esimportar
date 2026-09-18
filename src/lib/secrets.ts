import { createAdminClient } from "@/lib/supabase/server";
import { decrypt, encrypt, mask } from "@/lib/crypto";

/**
 * Catálogo de APIs y secrets configurables desde Configuración.
 * Orden de resolución: variable de entorno > valor guardado en app_secrets.
 */
export const SECRET_CATALOG: {
  key: string; label: string; group: string; desc: string; secret: boolean; placeholder?: string;
}[] = [
  { key: "META_APP_ID",        label: "Meta App ID",          group: "Meta Ads",   desc: "ID de la app Business en developers.facebook.com", secret: false, placeholder: "1234567890123456" },
  { key: "META_APP_SECRET",    label: "Meta App Secret",      group: "Meta Ads",   desc: "App Secret de la misma app. Solo se usa en el servidor.", secret: true },
  { key: "META_GRAPH_VERSION", label: "Versión Graph API",    group: "Meta Ads",   desc: "Opcional. Por defecto v21.0", secret: false, placeholder: "v21.0" },
  { key: "ANTHROPIC_API_KEY",  label: "Anthropic API key",    group: "IA",         desc: "Motor de extracción de documentos (Claude)", secret: true },
  { key: "ANTHROPIC_MODEL",    label: "Modelo Claude",        group: "IA",         desc: "Opcional. Por defecto claude-sonnet-4-5", secret: false, placeholder: "claude-sonnet-4-5" },
  { key: "CRON_SECRET",        label: "Cron secret",          group: "Sistema",    desc: "Protege el endpoint de sincronización horaria (Vercel Cron)", secret: true },
  { key: "RESEND_API_KEY",     label: "Resend API key",       group: "Integraciones", desc: "Envío de emails (resumen diario de Meta Ads)", secret: true },
  { key: "RESEND_FROM",        label: "Remitente Resend",     group: "Integraciones", desc: "Opcional. Ej. Meta Ads <ads@esimportar.com> (dominio verificado en Resend)", secret: false, placeholder: "Meta Ads <ads@esimportar.com>" },
  { key: "WHATSAPP_API_TOKEN", label: "WhatsApp token",       group: "Integraciones", desc: "WhatsApp Business API", secret: true },
  { key: "MERCADOPAGO_ACCESS_TOKEN", label: "Mercado Pago token", group: "Integraciones", desc: "Access token de Mercado Pago", secret: true },
];

const cache = new Map<string, { v: string | null; at: number }>();
const TTL = 30_000;

/** Devuelve el valor en claro (env > base). Solo server-side. */
export async function getSecret(key: string): Promise<string | null> {
  const env = process.env[key];
  if (env && env.trim()) return env.trim();

  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.v;

  try {
    const admin = createAdminClient();
    const { data } = await admin.from("app_secrets").select("value_enc").eq("key", key).maybeSingle();
    const v = data?.value_enc ? decrypt(data.value_enc) : null;
    cache.set(key, { v, at: Date.now() });
    return v;
  } catch {
    return null;
  }
}

export async function requireSecret(key: string): Promise<string> {
  const v = await getSecret(key);
  if (!v) throw new Error(`Falta configurar ${key}. Cargalo en Configuración → APIs y secrets.`);
  return v;
}

export async function setSecret(key: string, value: string, userId: string) {
  const admin = createAdminClient();
  const entry = SECRET_CATALOG.find(s => s.key === key);
  const { error } = await admin.from("app_secrets").upsert({
    key,
    value_enc: encrypt(value.trim()),
    is_secret: entry?.secret ?? true,
    updated_by: userId,
    updated_at: new Date().toISOString()
  });
  cache.delete(key);
  if (error) throw new Error(error.message);
}

export async function deleteSecret(key: string) {
  const admin = createAdminClient();
  await admin.from("app_secrets").delete().eq("key", key);
  cache.delete(key);
}

/** Estado de cada secret para la UI (nunca devuelve el valor real de los sensibles). */
export async function secretsStatus() {
  const admin = createAdminClient();
  const { data } = await admin.from("app_secrets").select("key, value_enc, is_secret, updated_at");
  const stored = new Map<string, any>((data ?? []).map((r: any) => [r.key, r]));

  return SECRET_CATALOG.map(s => {
    const env = process.env[s.key];
    const row = stored.get(s.key);
    let source: "env" | "db" | "none" = "none";
    let preview: string | null = null;
    if (env && env.trim()) {
      source = "env";
      preview = s.secret ? mask(env) : env;
    } else if (row) {
      source = "db";
      try {
        const v = decrypt(row.value_enc);
        preview = s.secret ? mask(v) : v;
      } catch { preview = "(no se pudo descifrar)"; }
    }
    return { ...s, source, preview, updated_at: row?.updated_at ?? null };
  });
}
