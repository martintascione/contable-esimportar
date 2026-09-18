import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/meta/http";
import { createAdminClient } from "@/lib/supabase/server";
import { SECRET_CATALOG, deleteSecret, secretsStatus, setSecret } from "@/lib/secrets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireAdmin() {
  const { user, res } = await requireUser();
  if (!user) return { user: null, res };
  const admin = createAdminClient();
  const { data } = await admin.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (data?.role !== "admin") return { user: null, res: NextResponse.json({ error: "Solo administradores" }, { status: 403 }) };
  return { user, res: null };
}

/** GET /api/secrets — estado de cada API/secret (sin valores sensibles). */
export async function GET() {
  const { user, res } = await requireAdmin();
  if (!user) return res!;
  try {
    return NextResponse.json({ ok: true, secrets: await secretsStatus(), encryption: !!process.env.APP_ENCRYPTION_KEY });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

/** POST /api/secrets { key, value } */
export async function POST(req: NextRequest) {
  const { user, res } = await requireAdmin();
  if (!user) return res!;
  const { key, value } = await req.json().catch(() => ({}));
  if (!SECRET_CATALOG.some(s => s.key === key)) return NextResponse.json({ error: "Clave desconocida" }, { status: 400 });
  if (typeof value !== "string" || !value.trim()) return NextResponse.json({ error: "Valor vacío" }, { status: 400 });
  try {
    await setSecret(key, value, user.id);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

/** DELETE /api/secrets?key=… */
export async function DELETE(req: NextRequest) {
  const { user, res } = await requireAdmin();
  if (!user) return res!;
  const key = req.nextUrl.searchParams.get("key");
  if (!key || !SECRET_CATALOG.some(s => s.key === key)) return NextResponse.json({ error: "Clave desconocida" }, { status: 400 });
  await deleteSecret(key);
  return NextResponse.json({ ok: true });
}
