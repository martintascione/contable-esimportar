import { NextResponse, type NextRequest } from "next/server";
import { requireUser, oauthRedirectUri } from "@/lib/meta/http";
import { oauthDialogUrl } from "@/lib/meta/api";
import { randomToken } from "@/lib/crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/meta/oauth/start — redirige al diálogo de login de Meta. */
export async function GET(req: NextRequest) {
  const { user, res } = await requireUser();
  if (!user) return res!;
  try {
    const state = randomToken(16);
    const url = await oauthDialogUrl(oauthRedirectUri(req), state);
    const r = NextResponse.redirect(url);
    r.cookies.set("meta_oauth_state", state, { httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: 600 });
    return r;
  } catch (e: any) {
    const back = new URL("/ads", req.url);
    back.searchParams.set("error", e.message ?? "No se pudo iniciar OAuth");
    return NextResponse.redirect(back);
  }
}
