/**
 * Cliente del BCRA — obtiene tipos de cambio oficiales con cache local.
 *
 * API pública del BCRA: https://api.bcra.gob.ar/estadisticas/v3.0/monetarias
 *
 * IDs de variables relevantes:
 *   - 4:  Tipo de Cambio Minorista ($/USD) — Vendedor
 *   - 5:  Tipo de Cambio Minorista ($/USD) — Comprador
 *   - 84: Tipo de Cambio Mayorista (Comunicación A 3500 — Ref)
 *
 * Para contabilidad de PyMEs argentinas usamos el minorista vendedor (id 4)
 * como default, que es lo que suele figurar en operaciones bancarias comunes.
 *
 * Fin de semana / feriado: BCRA no publica. Fallback: último TC anterior disponible.
 */

import { createAdminClient } from "@/lib/supabase/server";

const BCRA_API = "https://api.bcra.gob.ar/estadisticas/v3.0/monetarias";
const CACHE_MAX_AGE_DAYS = 365; // datos históricos no cambian

const VARIABLE_IDS = {
  USD: 4,   // minorista vendedor
  EUR: 45,  // TC minorista EUR (venta) — verificar disponibilidad en la API
} as const;

export type Moneda = "USD" | "EUR" | "ARS";

/**
 * Obtiene el TC oficial (vendedor minorista) para una fecha específica.
 * Estrategia:
 *   1. Buscar en cache local (tc_cache).
 *   2. Si no está, consultar BCRA para un rango pequeño alrededor de la fecha.
 *   3. Guardar en cache y devolver el TC de la fecha exacta (o el último anterior).
 *
 * @returns número (TC vendedor) o null si no se pudo obtener
 */
export async function getTcBCRA(fecha: string, moneda: Moneda): Promise<number | null> {
  if (moneda === "ARS") return 1;
  if (moneda !== "USD" && moneda !== "EUR") return null;

  const admin = createAdminClient();

  // 1. Buscar exacta en cache
  const { data: cached } = await admin
    .from("tc_cache")
    .select("fecha, tc_vendedor")
    .eq("moneda", moneda)
    .eq("fecha", fecha)
    .maybeSingle();

  if (cached?.tc_vendedor) return Number(cached.tc_vendedor);

  // 2. Buscar el último TC anterior en cache (para fines de semana/feriados)
  const { data: cachedPrev } = await admin
    .from("tc_cache")
    .select("fecha, tc_vendedor")
    .eq("moneda", moneda)
    .lte("fecha", fecha)
    .order("fecha", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Si el último cached es de hace menos de 3 días de la fecha buscada, sirve
  if (cachedPrev?.tc_vendedor) {
    const diffDays = Math.floor(
      (new Date(fecha).getTime() - new Date(cachedPrev.fecha).getTime()) / (1000 * 60 * 60 * 24)
    );
    if (diffDays <= 3) return Number(cachedPrev.tc_vendedor);
  }

  // 3. Consultar BCRA (rango de 7 días alrededor de la fecha para asegurar hit)
  const id = VARIABLE_IDS[moneda as "USD" | "EUR"];
  const desde = shiftDate(fecha, -3);
  const hasta = shiftDate(fecha, 3);
  const url = `${BCRA_API}/${id}?desde=${desde}&hasta=${hasta}`;

  try {
    const r = await fetch(url, {
      headers: { "User-Agent": "contable-ia/1.0" },
      // BCRA API es lenta a veces
      signal: AbortSignal.timeout(10000)
    });
    if (!r.ok) {
      // Si el BCRA falla y tenemos algo en cache prev, lo usamos aunque esté viejo
      if (cachedPrev?.tc_vendedor) return Number(cachedPrev.tc_vendedor);
      return null;
    }
    const json = await r.json();
    const results: Array<{ fecha: string; valor: number }> = json?.results ?? [];

    if (!results.length) {
      if (cachedPrev?.tc_vendedor) return Number(cachedPrev.tc_vendedor);
      return null;
    }

    // Guardar todos los datos que trajimos (upsert)
    for (const item of results) {
      await admin.from("tc_cache").upsert(
        {
          fecha: item.fecha,
          moneda,
          tc_vendedor: item.valor,
          fuente: "bcra",
          fetched_at: new Date().toISOString()
        },
        { onConflict: "fecha,moneda" }
      );
    }

    // Buscar en los resultados el más cercano <= fecha
    const eligible = results.filter(x => x.fecha <= fecha).sort((a, b) => b.fecha.localeCompare(a.fecha));
    if (eligible.length) return Number(eligible[0].valor);

    // Si no hay ninguno <= fecha (raro), devolver el primero
    return Number(results[0].valor);
  } catch (e) {
    // Timeout o error de red — usar cache viejo si existe
    if (cachedPrev?.tc_vendedor) return Number(cachedPrev.tc_vendedor);
    return null;
  }
}

/**
 * Versión bulk: obtiene TCs para varias fechas a la vez.
 * Optimiza consultas al BCRA agrupando por rango.
 */
export async function getTcBulk(
  fechas: string[],
  moneda: Moneda
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (moneda === "ARS") {
    fechas.forEach(f => out.set(f, 1));
    return out;
  }
  if (moneda !== "USD" && moneda !== "EUR") return out;

  if (!fechas.length) return out;
  const sorted = [...new Set(fechas)].sort();
  const min = sorted[0];
  const max = sorted[sorted.length - 1];

  const admin = createAdminClient();

  // 1. Traer todo el rango de cache de una
  const { data: cached } = await admin
    .from("tc_cache")
    .select("fecha, tc_vendedor")
    .eq("moneda", moneda)
    .gte("fecha", shiftDate(min, -7))
    .lte("fecha", max)
    .order("fecha", { ascending: true });

  const cacheMap = new Map<string, number>();
  for (const c of cached ?? []) {
    if (c.tc_vendedor) cacheMap.set(c.fecha, Number(c.tc_vendedor));
  }

  // 2. Detectar fechas faltantes
  const missing = sorted.filter(f => !closestOnOrBefore(cacheMap, f));
  if (missing.length) {
    // Consultar BCRA en un solo rango que las cubra
    const id = VARIABLE_IDS[moneda as "USD" | "EUR"];
    const desde = shiftDate(missing[0], -3);
    const hasta = shiftDate(missing[missing.length - 1], 3);
    const url = `${BCRA_API}/${id}?desde=${desde}&hasta=${hasta}`;
    try {
      const r = await fetch(url, {
        headers: { "User-Agent": "contable-ia/1.0" },
        signal: AbortSignal.timeout(15000)
      });
      if (r.ok) {
        const json = await r.json();
        const results: Array<{ fecha: string; valor: number }> = json?.results ?? [];
        // Upsert cache
        for (const item of results) {
          cacheMap.set(item.fecha, item.valor);
          await admin.from("tc_cache").upsert(
            {
              fecha: item.fecha,
              moneda,
              tc_vendedor: item.valor,
              fuente: "bcra",
              fetched_at: new Date().toISOString()
            },
            { onConflict: "fecha,moneda" }
          );
        }
      }
    } catch { /* silent — usamos lo que haya */ }
  }

  // 3. Para cada fecha pedida, buscar el TC exacto o el último anterior
  for (const f of sorted) {
    const tc = closestOnOrBefore(cacheMap, f);
    if (tc !== null) out.set(f, tc);
  }
  return out;
}

function closestOnOrBefore(map: Map<string, number>, fecha: string): number | null {
  if (map.has(fecha)) return map.get(fecha)!;
  const anterior = Array.from(map.keys()).filter(k => k <= fecha).sort().pop();
  return anterior ? (map.get(anterior) ?? null) : null;
}

function shiftDate(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}
