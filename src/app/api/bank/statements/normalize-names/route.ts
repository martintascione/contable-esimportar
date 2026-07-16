import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getActiveCompany } from "@/lib/supabase/active";
import { normalizeBancoName, findSimilarBank } from "@/lib/banks";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/bank/statements/normalize-names
 * Body opcional: { dryRun?: boolean }
 *
 * Recorre todos los bank_statements de la empresa activa y aplica
 * normalizeBancoName al campo `banco`. Consolida variantes como
 * "Banco Galicia S.A.U." y "GALICIA" bajo el nombre canónico "Banco Galicia".
 *
 * Es idempotente: correrlo dos veces no cambia nada la segunda vez.
 */
export async function POST(req: NextRequest) {
  const { user, companyId } = await getActiveCompany();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!companyId) return NextResponse.json({ error: "Sin empresa activa" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const dryRun: boolean = !!body?.dryRun;

  const admin = createAdminClient();
  const { data: statements, error } = await admin
    .from("bank_statements")
    .select("id, banco")
    .eq("company_id", companyId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Paso 1: aplicar reglas hardcoded a cada nombre y quedarnos con los canónicos
  const withCanonical = (statements ?? []).map(st => ({
    id: st.id,
    original: st.banco,
    canonical: normalizeBancoName(st.banco)
  }));

  // Paso 2: consolidar variantes cercanas usando Jaro-Winkler.
  // Ejemplo: si aparecen "Banco XYZ" y "Bco XYZ Argentina" (ambos no matchean
  // ninguna regla pero son claramente el mismo), agrupamos bajo el más frecuente.
  const canonicalSet = Array.from(new Set(withCanonical.map(x => x.canonical)));
  // Contar frecuencia para elegir el "ganador" cuando hay merge
  const freq = new Map<string, number>();
  for (const x of withCanonical) freq.set(x.canonical, (freq.get(x.canonical) ?? 0) + 1);

  // Para cada nombre canónico, si hay otro más frecuente que sea "similar", lo redirige
  const remap = new Map<string, string>();
  for (const c of canonicalSet) {
    const others = canonicalSet.filter(o => o !== c);
    const similar = findSimilarBank(c, others);
    if (similar) {
      // Redirige al más frecuente (o alfabéticamente primero si empatan)
      const winner = (freq.get(similar) ?? 0) >= (freq.get(c) ?? 0) ? similar : c;
      const loser = winner === c ? similar : c;
      remap.set(loser, winner);
    }
  }

  // Resolver cadenas de remap (A→B, B→C → A→C)
  for (const [k] of remap) {
    let v = remap.get(k)!;
    const visited = new Set<string>([k]);
    while (remap.has(v) && !visited.has(v)) { visited.add(v); v = remap.get(v)!; }
    remap.set(k, v);
  }

  const changes: { id: string; before: string; after: string }[] = [];
  for (const x of withCanonical) {
    const finalName = remap.get(x.canonical) ?? x.canonical;
    if (finalName !== x.original) {
      changes.push({ id: x.id, before: x.original, after: finalName });
    }
  }

  if (dryRun) {
    // Agrupamos los cambios para mostrar el efecto neto
    const grouped = new Map<string, { after: string; count: number; ejemplos: string[] }>();
    for (const c of changes) {
      const key = `${c.before}→${c.after}`;
      if (!grouped.has(key)) grouped.set(key, { after: c.after, count: 0, ejemplos: [] });
      const g = grouped.get(key)!;
      g.count++;
      if (g.ejemplos.length < 3) g.ejemplos.push(c.before);
    }
    return NextResponse.json({
      ok: true,
      would_update: changes.length,
      total_statements: statements?.length ?? 0,
      transformaciones: Array.from(grouped.entries()).map(([, v]) => ({
        after: v.after,
        count: v.count,
        ejemplos_before: v.ejemplos
      }))
    });
  }

  let updated = 0;
  for (const c of changes) {
    const { error: upErr } = await admin
      .from("bank_statements")
      .update({ banco: c.after })
      .eq("id", c.id);
    if (!upErr) updated++;
  }

  return NextResponse.json({
    ok: true,
    updated,
    total_statements: statements?.length ?? 0,
    ejemplos: changes.slice(0, 10)
  });
}
