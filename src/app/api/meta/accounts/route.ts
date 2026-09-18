import { NextResponse } from "next/server";
import { requireUser } from "@/lib/meta/http";
import { getAccessToken } from "@/lib/meta/connection";
import { listAdAccounts } from "@/lib/meta/api";
import { createAdminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/meta/accounts — cuentas publicitarias visibles con la conexión actual. */
export async function GET() {
  const { user, res } = await requireUser();
  if (!user) return res!;
  const conn = await getAccessToken(user.id);
  if (!conn) return NextResponse.json({ error: "Sin conexión con Meta" }, { status: 400 });
  try {
    const [accounts, existing] = await Promise.all([
      listAdAccounts(conn.token),
      createAdminClient().from("ad_projects").select("ad_account_id").eq("user_id", user.id)
    ]);
    const used = new Set((existing.data ?? []).map((p: any) => p.ad_account_id));
    return NextResponse.json({
      ok: true,
      accounts: accounts.map(a => ({
        id: a.id, account_id: a.account_id, name: a.name, currency: a.currency,
        timezone: a.timezone_name ?? null, status: a.account_status ?? null,
        business: a.business?.name ?? null, in_use: used.has(a.id)
      }))
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? "Error consultando Meta" }, { status: 502 });
  }
}
