import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Usuario autenticado o 401. */
export async function requireUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { user: null, res: NextResponse.json({ error: "No autenticado" }, { status: 401 }) };
  return { user, res: null };
}

/** URL pública del sitio (para el redirect de OAuth). */
export function siteUrl(req: NextRequest) {
  const env = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
  if (env && !env.includes("localhost")) return env;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? new URL(req.url).host;
  const proto = req.headers.get("x-forwarded-proto") ?? (host.includes("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export function oauthRedirectUri(req: NextRequest) {
  return `${siteUrl(req)}/api/meta/oauth/callback`;
}
