import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getActiveCompany } from "@/lib/supabase/active";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/bank-files/backfill-names
 * Body opcional: { dryRun?: boolean, overwrite?: boolean }
 *
 * Asigna nombres humanos a extractos bancarios pre-migración.
 * Ejemplos:
 *   - "Extracto Santander - Mar 2026.pdf"
 *   - "Extracto Galicia cta 1234 - Ene 2026.pdf"
 *   - "Extracto Ciudad - Feb-Mar 2026.csv"
 */
export async function POST(req: NextRequest) {
  const { user, companyId } = await getActiveCompany();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!companyId) return NextResponse.json({ error: "Sin empresa activa" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const dryRun: boolean = !!body?.dryRun;
  const overwrite: boolean = !!body?.overwrite;

  const admin = createAdminClient();

  const { data: statements, error } = await admin
    .from("bank_statements")
    .select("id, storage_path, original_filename, banco, cuenta, periodo_desde, periodo_hasta")
    .eq("company_id", companyId)
    .not("storage_path", "is", null);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const previews: { storage_path: string; before: string | null; after: string }[] = [];
  const updates: { id: string; name: string }[] = [];

  for (const st of statements ?? []) {
    if (!overwrite && (st.original_filename ?? "").trim().length > 0) continue;
    const name = suggestBankFilename(st as any);
    previews.push({
      storage_path: st.storage_path!,
      before: st.original_filename,
      after: name
    });
    updates.push({ id: st.id, name });
  }

  if (dryRun) {
    return NextResponse.json({
      ok: true,
      would_update: previews.length,
      previews: previews.slice(0, 100)
    });
  }

  let updated = 0;
  for (const u of updates) {
    const { error: upErr } = await admin
      .from("bank_statements")
      .update({ original_filename: u.name })
      .eq("id", u.id);
    if (!upErr) updated++;
  }

  return NextResponse.json({
    ok: true,
    procesados: updated,
    ejemplos: previews.slice(0, 10).map(p => ({ before: p.before, after: p.after }))
  });
}

const MESES_ABREV = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

type St = {
  id: string;
  storage_path: string;
  original_filename: string | null;
  banco: string;
  cuenta: string | null;
  periodo_desde: string | null;
  periodo_hasta: string | null;
};

function suggestBankFilename(st: St): string {
  const ext = detectExtension(st.storage_path);
  const banco = sanitize(st.banco || "Banco");
  const cuenta = st.cuenta ? ` cta ${truncate(sanitize(st.cuenta), 12)}` : "";
  const periodo = periodoLabel(st.periodo_desde ?? undefined, st.periodo_hasta ?? undefined);
  return `Extracto ${banco}${cuenta} - ${periodo}.${ext}`;
}

function detectExtension(path: string): string {
  const last = path.split("/").pop() ?? "";
  const dot = last.lastIndexOf(".");
  if (dot < 0) return "pdf";
  const ext = last.slice(dot + 1).toLowerCase();
  if (!ext || ext.length > 5) return "pdf";
  return ext;
}

// Parseamos "YYYY-MM-DD" a { year, month0 } sin pasar por Date (evita bug de zona horaria
// donde new Date("2026-03-15") interpreta UTC y en Argentina puede dar el día anterior)
function parseYmd(s: string): { year: number; month0: number } | null {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const year = Number(m[1]);
  const month0 = Number(m[2]) - 1;
  if (month0 < 0 || month0 > 11) return null;
  return { year, month0 };
}

function periodoLabel(desde?: string, hasta?: string): string {
  if (!desde) return "sin fecha";
  const d = parseYmd(desde);
  if (!d) return "sin fecha";
  const h = hasta ? (parseYmd(hasta) ?? d) : d;
  const same = d.year === h.year && d.month0 === h.month0;
  if (same) return `${MESES_ABREV[d.month0]} ${d.year}`;
  const sameYear = d.year === h.year;
  if (sameYear) return `${MESES_ABREV[d.month0]}-${MESES_ABREV[h.month0]} ${d.year}`;
  return `${MESES_ABREV[d.month0]} ${d.year} - ${MESES_ABREV[h.month0]} ${h.year}`;
}

function sanitize(s: string): string {
  return s.replace(/[\/\\?%*:|"<>]/g, "").replace(/\s+/g, " ").trim();
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1).trimEnd() + "…";
}
