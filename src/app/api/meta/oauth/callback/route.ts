import { NextResponse, type NextRequest } from "next/server";
import { requireUser, oauthRedirectUri } from "@/lib/meta/http";
import { exchangeCodeForLongLivedToken } from "@/lib/meta/api";
import { saveConnection } from "@/lib/meta/connection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/meta/oauth/callback — canjea el code por un token largo y lo guarda cifrado. */
export async function GET(req: NextRequest) {
  const { user, res } = await requireUser();
  if (!user) return res!;

  const back = new URL("/ads", req.url);
  const sp = req.nextUrl.searchParams;
  const code = sp.get("code");
  const state = sp.get("state");
  const cookieState = req.cookies.get("meta_oauth_state")?.value;

  if (sp.get("error")) {
    back.searchParams.set("error", sp.get("error_description") ?? sp.get("error")!);
    return NextResponse.redirect(back);
  }
  if (!code || !state || state !== cookieState) {
    back.searchParams.set("error", "Estado OAuth inválido. Probá de nuevo.");
    return NextResponse.redirect(back);
  }

  try {
    const t = await exchangeCodeForLongLivedToken(code, oauthRedirectUri(req));
    await saveConnection(user.id, t);
    back.searchParams.set("connected", "1");
  } catch (e: any) {
    back.searchParams.set("error", e.message ?? "No se pudo conectar con Meta");
  }
  const r = NextResponse.redirect(back);
  r.cookies.set("meta_oauth_state", "", { path: "/", maxAge: 0 });
  return r;
}
