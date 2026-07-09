import { NextResponse, type NextRequest } from "next/server";

export const runtime = "nodejs";

/**
 * POST /api/setup/validate
 * Body: { supabaseUrl, anonKey, serviceRoleKey, anthropicKey, anthropicModel? }
 *
 * Prueba las credenciales SIN persistirlas. Úsalo desde el wizard /setup antes de guardar.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { supabaseUrl, anonKey, serviceRoleKey, anthropicKey } = body;
  const anthropicModel = body.anthropicModel || "claude-sonnet-4-5";

  const result: Record<string, any> = {
    supabase: { ok: false, message: "Sin datos" },
    supabaseTables: { ok: false, message: "—" },
    supabaseStorage: { ok: false, message: "—" },
    anthropic: { ok: false, message: "Sin datos" }
  };

  // 1) Supabase anon reach — /auth/v1/settings es público con anon key
  if (supabaseUrl && anonKey) {
    try {
      const res = await fetch(`${supabaseUrl}/auth/v1/settings`, {
        headers: { apikey: anonKey }
      });
      // Cualquier respuesta del dominio (incluso 401/404) significa que el proyecto existe y está vivo.
      // Solo fallamos ante errores de red o 5xx.
      if (res.ok) {
        result.supabase = { ok: true, message: "Proyecto accesible" };
      } else if (res.status >= 500) {
        result.supabase = { ok: false, message: `Supabase respondió HTTP ${res.status}` };
      } else {
        result.supabase = { ok: true, message: `Proyecto vivo (auth settings ${res.status})` };
      }
    } catch (e: any) {
      result.supabase = { ok: false, message: "Red: " + e.message };
    }
  }

  // 2) Supabase — service role + tablas
  if (supabaseUrl && serviceRoleKey) {
    try {
      const res = await fetch(`${supabaseUrl}/rest/v1/companies?select=id&limit=1`, {
        headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` }
      });
      if (res.ok) {
        result.supabaseTables = { ok: true, message: "Tabla companies detectada" };
      } else if (res.status === 404 || res.status === 400) {
        result.supabaseTables = { ok: false, message: "Falta ejecutar supabase/migrations/0001_initial_schema.sql" };
      } else {
        result.supabaseTables = { ok: false, message: `HTTP ${res.status} (revisá service_role)` };
      }
    } catch (e: any) {
      result.supabaseTables = { ok: false, message: "Red: " + e.message };
    }
  }

  // 3) Supabase Storage — listar buckets
  if (supabaseUrl && serviceRoleKey) {
    try {
      const res = await fetch(`${supabaseUrl}/storage/v1/bucket`, {
        headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` }
      });
      if (res.ok) {
        const data = await res.json();
        const names = Array.isArray(data) ? data.map((b: any) => b.name) : [];
        const required = ["invoices", "bank-statements", "company-documents"];
        const missing = required.filter(n => !names.includes(n));
        result.supabaseStorage = missing.length
          ? { ok: false, message: "Faltan buckets: " + missing.join(", ") }
          : { ok: true, message: `${names.length} buckets listos` };
      } else {
        result.supabaseStorage = { ok: false, message: `HTTP ${res.status}` };
      }
    } catch (e: any) {
      result.supabaseStorage = { ok: false, message: "Red: " + e.message };
    }
  }

  // 4) Anthropic
  if (anthropicKey) {
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": anthropicKey,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model: anthropicModel,
          max_tokens: 16,
          messages: [{ role: "user", content: "Respondé solo OK" }]
        })
      });
      if (res.ok) {
        result.anthropic = { ok: true, message: `API key válida (${anthropicModel})` };
      } else {
        const t = await res.text();
        result.anthropic = { ok: false, message: `HTTP ${res.status}: ${t.slice(0, 180)}` };
      }
    } catch (e: any) {
      result.anthropic = { ok: false, message: "Red: " + e.message };
    }
  }

  return NextResponse.json(result);
}
