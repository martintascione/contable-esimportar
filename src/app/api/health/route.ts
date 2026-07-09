import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * GET /api/health
 * Devuelve el estado de las conexiones críticas:
 *   - Supabase (URL, anon key, service role, tablas creadas)
 *   - Anthropic / Claude (API key, modelo)
 *
 * Nunca expone las credenciales reales, solo si están configuradas y si responden.
 */
export async function GET() {
  const supabaseUrl   = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnon  = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const supabaseRole  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anthropicKey  = process.env.ANTHROPIC_API_KEY;
  const anthropicModel= process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";

  const supabaseConfigured = Boolean(supabaseUrl && supabaseAnon && supabaseRole);
  const anthropicConfigured = Boolean(anthropicKey);

  // Supabase live check — ping /rest/v1 con la anon key
  let supabaseLive: { ok: boolean; message: string; tablesOk?: boolean } = {
    ok: false, message: "No configurado"
  };
  if (supabaseConfigured) {
    try {
      const res = await fetch(`${supabaseUrl}/auth/v1/settings`, {
        headers: { apikey: supabaseAnon! }
      });
      // 200 / 401 / 404 => proyecto vivo. 5xx o error de red => caído.
      const alive = res.ok || (res.status >= 400 && res.status < 500);
      supabaseLive = {
        ok: alive,
        message: alive ? "Conectado" : `HTTP ${res.status}`
      };
      // Chequeo rápido de que exista la tabla companies
      if (res.ok) {
        const t = await fetch(`${supabaseUrl}/rest/v1/companies?select=id&limit=1`, {
          headers: {
            apikey: supabaseRole!,
            Authorization: `Bearer ${supabaseRole}`
          }
        });
        supabaseLive.tablesOk = t.ok;
        if (!t.ok) supabaseLive.message = "Conectado — falta ejecutar el SQL de migración";
      }
    } catch (e: any) {
      supabaseLive = { ok: false, message: "Error de red: " + e.message };
    }
  }

  // Anthropic live check — llamada mínima a /v1/messages
  let anthropicLive: { ok: boolean; message: string } = {
    ok: false, message: "No configurado"
  };
  if (anthropicConfigured) {
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": anthropicKey!,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model: anthropicModel,
          max_tokens: 8,
          messages: [{ role: "user", content: "ping" }]
        })
      });
      if (res.ok) {
        anthropicLive = { ok: true, message: `Conectado (${anthropicModel})` };
      } else {
        const t = await res.text();
        anthropicLive = { ok: false, message: `HTTP ${res.status}: ${t.slice(0, 160)}` };
      }
    } catch (e: any) {
      anthropicLive = { ok: false, message: "Error de red: " + e.message };
    }
  }

  return NextResponse.json({
    supabase: {
      configured: supabaseConfigured,
      url: supabaseUrl ? mask(supabaseUrl) : null,
      anonKey: supabaseAnon ? maskKey(supabaseAnon) : null,
      serviceRole: supabaseRole ? maskKey(supabaseRole) : null,
      ...supabaseLive
    },
    anthropic: {
      configured: anthropicConfigured,
      apiKey: anthropicKey ? maskKey(anthropicKey) : null,
      model: anthropicModel,
      ...anthropicLive
    },
    ready: supabaseLive.ok && (supabaseLive.tablesOk ?? true) && anthropicLive.ok
  });
}

function mask(v: string) {
  if (v.length <= 16) return v.slice(0, 4) + "…";
  return v.slice(0, 24) + "…" + v.slice(-6);
}
function maskKey(v: string) {
  if (v.length <= 12) return "••••";
  return v.slice(0, 6) + "…" + v.slice(-4);
}
