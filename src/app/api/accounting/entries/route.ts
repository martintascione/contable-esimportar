import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getActiveCompany } from "@/lib/supabase/active";

export const runtime = "nodejs";

/** GET /api/accounting/entries?desde=YYYY-MM-DD&hasta=YYYY-MM-DD&limit=N */
export async function GET(req: NextRequest) {
  const { user, companyId } = await getActiveCompany();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!companyId) return NextResponse.json({ error: "Sin empresa activa" }, { status: 400 });

  const desde = req.nextUrl.searchParams.get("desde");
  const hasta = req.nextUrl.searchParams.get("hasta");
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? "200");

  const admin = createAdminClient();
  let q = admin.from("journal_entries")
    .select("id, numero, fecha, concepto, source, source_id, total_debe, total_haber, status, created_at, journal_entry_lines(id, account_id, descripcion, debe, haber, ord, accounts(code, name, type))")
    .eq("company_id", companyId)
    .order("fecha", { ascending: false })
    .order("numero", { ascending: false })
    .limit(limit);
  if (desde) q = q.gte("fecha", desde);
  if (hasta) q = q.lte("fecha", hasta);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ entries: data ?? [] });
}

/**
 * POST /api/accounting/entries
 * Body: { fecha, concepto, observaciones?, lines: [{ account_id, descripcion?, debe, haber }] }
 */
export async function POST(req: NextRequest) {
  const { user, companyId, role } = await getActiveCompany();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!companyId) return NextResponse.json({ error: "Sin empresa activa" }, { status: 400 });
  if (role !== "admin") return NextResponse.json({ error: "Solo admin" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const fecha = String(body.fecha ?? "").trim();
  const concepto = String(body.concepto ?? "").trim();
  const lines = Array.isArray(body.lines) ? body.lines : [];

  if (!fecha) return NextResponse.json({ error: "Falta fecha" }, { status: 400 });
  if (!concepto) return NextResponse.json({ error: "Falta concepto" }, { status: 400 });
  if (lines.length < 2) return NextResponse.json({ error: "El asiento necesita al menos 2 líneas" }, { status: 400 });

  // Validar que cada línea tenga cuenta y debe XOR haber
  for (const [i, l] of lines.entries()) {
    if (!l.account_id) return NextResponse.json({ error: `Línea ${i + 1}: falta cuenta` }, { status: 400 });
    const debe  = Number(l.debe ?? 0)  || 0;
    const haber = Number(l.haber ?? 0) || 0;
    if (debe < 0 || haber < 0) return NextResponse.json({ error: `Línea ${i + 1}: importe negativo` }, { status: 400 });
    if (debe === 0 && haber === 0) return NextResponse.json({ error: `Línea ${i + 1}: debe o haber > 0` }, { status: 400 });
    if (debe > 0 && haber > 0) return NextResponse.json({ error: `Línea ${i + 1}: una línea va al debe O al haber, no a los dos` }, { status: 400 });
  }

  // Validar suma debe = haber (con tolerancia 0.01 por redondeo)
  const totalDebe  = lines.reduce((a: number, l: any) => a + (Number(l.debe)  || 0), 0);
  const totalHaber = lines.reduce((a: number, l: any) => a + (Number(l.haber) || 0), 0);
  if (Math.abs(totalDebe - totalHaber) > 0.01) {
    return NextResponse.json({
      error: `El asiento no balancea: Debe ${totalDebe.toFixed(2)} ≠ Haber ${totalHaber.toFixed(2)}`
    }, { status: 400 });
  }

  const admin = createAdminClient();

  // Validar que las cuentas pertenezcan a la empresa y sean imputables
  const accountIds = Array.from(new Set(lines.map((l: any) => l.account_id)));
  const { data: accs } = await admin
    .from("accounts").select("id, is_imputable, company_id")
    .in("id", accountIds);
  if ((accs?.length ?? 0) !== accountIds.length) {
    return NextResponse.json({ error: "Una o más cuentas no existen" }, { status: 400 });
  }
  for (const a of accs ?? []) {
    if (a.company_id !== companyId) return NextResponse.json({ error: "Cuenta de otra empresa" }, { status: 403 });
    if (!a.is_imputable) return NextResponse.json({ error: "No se puede imputar a una cuenta agrupadora" }, { status: 400 });
  }

  // Crear el asiento
  const { data: entry, error: entryErr } = await admin.from("journal_entries").insert({
    company_id: companyId,
    fecha,
    concepto,
    source: body.source ?? "manual",
    source_id: body.source_id ?? null,
    observaciones: body.observaciones ?? null,
    created_by: user.id
  }).select().single();

  if (entryErr || !entry) return NextResponse.json({ error: entryErr?.message ?? "Error" }, { status: 500 });

  // Insertar líneas
  const linesData = lines.map((l: any, idx: number) => ({
    entry_id: entry.id,
    account_id: l.account_id,
    descripcion: l.descripcion ?? null,
    debe: Number(l.debe)  || 0,
    haber: Number(l.haber) || 0,
    ord: idx
  }));
  const { error: linesErr } = await admin.from("journal_entry_lines").insert(linesData);
  if (linesErr) {
    await admin.from("journal_entries").delete().eq("id", entry.id);
    return NextResponse.json({ error: "Error al guardar líneas: " + linesErr.message }, { status: 500 });
  }

  // Releer entry con números actualizados
  const { data: full } = await admin
    .from("journal_entries")
    .select("id, numero, fecha, concepto, total_debe, total_haber, status")
    .eq("id", entry.id).single();

  return NextResponse.json({ ok: true, entry: full });
}
