import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getActiveCompany } from "@/lib/supabase/active";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/invoice-files/backfill-names
 * Body opcional: { dryRun?: boolean, overwrite?: boolean }
 *
 * Recorre las facturas de la empresa activa que TIENEN storage_path pero
 * NO tienen original_filename (o si overwrite=true, todas las que tengan storage_path),
 * agrupa por storage_path y genera un nombre humano basado en:
 *   - el tipo detectado por el path (arca-list, arca-csv, individual)
 *   - la extensión del archivo
 *   - el período que cubren las facturas
 *   - la razón social / comprobante si es una factura individual
 *
 * Ejemplos:
 *   - "Listado ARCA - Mar 2026.pdf"
 *   - "Mis Comprobantes ARCA - Nov 2025.xlsx"
 *   - "Factura A 0001-00234 - Coto SA.pdf"
 *   - "3 facturas - Dic 2025.pdf"
 */
export async function POST(req: NextRequest) {
  const { user, companyId } = await getActiveCompany();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!companyId) return NextResponse.json({ error: "Sin empresa activa" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const dryRun: boolean = !!body?.dryRun;
  const overwrite: boolean = !!body?.overwrite;

  const admin = createAdminClient();

  // Traemos todas las facturas con storage_path
  const { data: invoices, error } = await admin
    .from("invoices")
    .select("id, storage_path, original_filename, tipo, fecha, razon_social, comprobante, ai_metadata")
    .eq("company_id", companyId)
    .not("storage_path", "is", null);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Agrupar por storage_path
  const groups = new Map<string, typeof invoices>();
  for (const inv of invoices ?? []) {
    if (!inv.storage_path) continue;
    if (!groups.has(inv.storage_path)) groups.set(inv.storage_path, []);
    groups.get(inv.storage_path)!.push(inv);
  }

  const previews: { storage_path: string; before: string | null; after: string; facturas: number }[] = [];
  const updatesByPath: { path: string; name: string; ids: string[] }[] = [];

  for (const [path, facts] of groups.entries()) {
    // Si ya todas tienen un original_filename y no hay overwrite, saltamos
    const hasSome = facts.some(f => (f.original_filename ?? "").trim().length > 0);
    if (hasSome && !overwrite) continue;

    const currentName = facts.find(f => f.original_filename)?.original_filename ?? null;
    const suggested = suggestFilename(path, facts as any);

    previews.push({
      storage_path: path,
      before: currentName,
      after: suggested,
      facturas: facts.length
    });
    updatesByPath.push({
      path,
      name: suggested,
      ids: facts.filter(f => overwrite || !f.original_filename).map(f => f.id)
    });
  }

  if (dryRun) {
    return NextResponse.json({
      ok: true,
      would_update_archivos: previews.length,
      would_update_facturas: updatesByPath.reduce((a, u) => a + u.ids.length, 0),
      previews: previews.slice(0, 100)
    });
  }

  let updated = 0;
  for (const u of updatesByPath) {
    if (!u.ids.length) continue;
    const { error: upErr, count } = await admin
      .from("invoices")
      .update({ original_filename: u.name }, { count: "exact" })
      .in("id", u.ids);
    if (!upErr) updated += count ?? u.ids.length;
  }

  return NextResponse.json({
    ok: true,
    archivos_procesados: previews.length,
    facturas_actualizadas: updated,
    ejemplos: previews.slice(0, 10).map(p => ({ before: p.before, after: p.after, facturas: p.facturas }))
  });
}

// ============================================================================
// Lógica de sugerencia de nombre
// ============================================================================

const MESES_ABREV = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

type Fact = {
  id: string;
  storage_path: string;
  original_filename: string | null;
  tipo: string;
  fecha: string;
  razon_social: string;
  comprobante: string | null;
  ai_metadata: any;
};

function suggestFilename(path: string, facts: Fact[]): string {
  const p = path.toLowerCase();
  const ext = detectExtension(path);

  const fechas = facts.map(f => f.fecha).filter(Boolean).sort();
  const periodo = periodoLabel(fechas[0], fechas[fechas.length - 1]);

  const esListadoArca = p.includes("arca-list");
  const esCsvArca     = p.includes("arca-csv") || ext === "xlsx" || ext === "xls" || ext === "csv";
  const esIndividual  = !esListadoArca && !esCsvArca && facts.length === 1;

  // Individual: usar comprobante + razón social
  if (esIndividual) {
    const f = facts[0];
    const comp = (f.comprobante ?? "").trim();
    const razon = truncate(sanitize(f.razon_social ?? ""), 40);
    const parts = [comp, razon].filter(Boolean);
    if (parts.length) return `${parts.join(" - ")}.${ext}`;
    return `Factura ${f.fecha ?? ""}.${ext}`;
  }

  // Listado ARCA (PDF): varias facturas dentro del mismo listado
  if (esListadoArca) {
    // Detectar si son emitidos o recibidos por el ai_metadata o por el tipo mayoritario
    const emit = facts.filter(f => f.tipo === "venta").length;
    const rec  = facts.filter(f => f.tipo === "compra").length;
    const kind = emit > rec ? "Emitidos" : rec > emit ? "Recibidos" : "Comprobantes";
    return `Listado ARCA ${kind} - ${periodo}.${ext}`;
  }

  // CSV/Excel ARCA
  if (esCsvArca) {
    return `Mis Comprobantes ARCA - ${periodo}.${ext}`;
  }

  // Fallback: varios archivos individuales agrupados (poco común)
  if (facts.length > 1) {
    return `${facts.length} facturas - ${periodo}.${ext}`;
  }

  return `Archivo ${periodo}.${ext}`;
}

function detectExtension(path: string): string {
  const last = path.split("/").pop() ?? "";
  const dot = last.lastIndexOf(".");
  if (dot < 0) return "pdf";
  const ext = last.slice(dot + 1).toLowerCase();
  if (!ext || ext.length > 5) return "pdf";
  return ext;
}

// Parseamos "YYYY-MM-DD" sin pasar por Date (evita bug de zona horaria UTC → día anterior)
function parseYmd(s: string): { year: number; month0: number } | null {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const year = Number(m[1]);
  const month0 = Number(m[2]) - 1;
  if (month0 < 0 || month0 > 11) return null;
  return { year, month0 };
}

function periodoLabel(desde: string | undefined, hasta: string | undefined): string {
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
