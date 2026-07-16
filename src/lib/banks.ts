/**
 * Normalización de nombres de bancos argentinos.
 *
 * La IA extrae el nombre del banco tal cual aparece en el PDF, y ese texto
 * varía mucho entre un extracto y otro:
 *   - "Banco Galicia"
 *   - "Banco de Galicia y Buenos Aires S.A.U."
 *   - "BANCO GALICIA"
 *   - "GALICIA"
 *   - "Banco Galicia y Buenos Aires"
 *
 * Todas esas variantes deberían mostrarse como "Banco Galicia" en el UI y
 * agruparse en el sidebar como un único banco.
 *
 * Este helper aplica reglas de keywords a un nombre crudo y devuelve el
 * nombre canónico. Si no matchea ninguna regla, devuelve el original limpio
 * (sin "S.A.", sin espacios de más, capitalizado).
 */

type BankRule = {
  canonical: string;
  patterns: RegExp[];
};

// Reglas ordenadas: las primeras que matchean ganan.
// Los patterns son case-insensitive y trabajan sobre el nombre normalizado
// (sin tildes, todo minúsculas).
const BANK_RULES: BankRule[] = [
  { canonical: "Banco Galicia",       patterns: [/\bgalicia\b/] },
  { canonical: "Banco Santander",     patterns: [/\bsantander\b/] },
  { canonical: "Banco Macro",         patterns: [/\bmacro\b/] },
  { canonical: "BBVA",                patterns: [/\bbbva\b/, /\bfrances\b/, /banco\s+frances/] },
  { canonical: "HSBC",                patterns: [/\bhsbc\b/] },
  { canonical: "Banco Nación",        patterns: [/\bnacion\b/, /banco\s+de\s+la\s+nacion/] },
  { canonical: "Banco Provincia",     patterns: [/banco\s+(de\s+la\s+)?provincia/, /\bbapro\b/] },
  { canonical: "Banco Ciudad",        patterns: [/banco\s+(de\s+la\s+)?ciudad/] },
  { canonical: "Banco Supervielle",   patterns: [/\bsupervielle\b/] },
  { canonical: "Itaú",                patterns: [/\bitau\b/] },
  { canonical: "Banco Credicoop",     patterns: [/\bcredicoop\b/] },
  { canonical: "Banco Patagonia",     patterns: [/\bpatagonia\b/] },
  { canonical: "ICBC",                patterns: [/\bicbc\b/, /industrial\s+and\s+commercial/] },
  { canonical: "Banco Hipotecario",   patterns: [/\bhipotecario\b/] },
  { canonical: "Banco Comafi",        patterns: [/\bcomafi\b/] },
  { canonical: "Banco Piano",         patterns: [/\bpiano\b/] },
  { canonical: "Banco Roela",         patterns: [/\broela\b/] },
  { canonical: "Banco Meridian",      patterns: [/\bmeridian\b/] },
  { canonical: "Banco Bica",          patterns: [/\bbica\b/] },
  { canonical: "Banco de Corrientes", patterns: [/banco\s+(de\s+)?corrientes/] },
  { canonical: "Banco de Córdoba",    patterns: [/\bbancor\b/, /banco\s+(de\s+)?cordoba/] },
  { canonical: "Banco Chubut",        patterns: [/\bchubut\b/] },
  { canonical: "Banco Formosa",       patterns: [/\bformosa\b/] },
  { canonical: "Banco Santa Cruz",    patterns: [/santa\s+cruz/] },
  { canonical: "Banco San Juan",      patterns: [/san\s+juan/] },
  { canonical: "Banco Santa Fe",      patterns: [/santa\s+fe/] },
  { canonical: "Banco Entre Ríos",    patterns: [/entre\s+rios/] },
  { canonical: "Nuevo Banco del Chaco", patterns: [/nuevo\s+banco\s+(del\s+)?chaco/, /\bnbch\b/] },
  { canonical: "Banco de Tierra del Fuego", patterns: [/tierra\s+del\s+fuego/] },
  { canonical: "Banco de La Pampa",   patterns: [/la\s+pampa/, /\bblp\b/] },
  { canonical: "Banco del Sol",       patterns: [/banco\s+del\s+sol/] },
  { canonical: "Rebanking",           patterns: [/\brebanking\b/, /\brebank\b/] },
  { canonical: "Brubank",             patterns: [/\bbrubank\b/] },
  { canonical: "Naranja X",           patterns: [/\bnaranja\s*x\b/, /\bnaranja\b/] },
  { canonical: "Mercado Pago",        patterns: [/mercado\s*pago/, /\bmp\b(?!\w)/] },
  { canonical: "Ualá",                patterns: [/\buala\b/] },
  { canonical: "Personal Pay",        patterns: [/personal\s*pay/] },
  { canonical: "Cuenta DNI",          patterns: [/cuenta\s*dni/] },
  { canonical: "Modo",                patterns: [/^modo$/] },
  { canonical: "Wilobank",            patterns: [/\bwilobank\b/, /\bwilo\b/] },
  { canonical: "Openbank",            patterns: [/\bopenbank\b/] },
  { canonical: "Reba",                patterns: [/^reba$/] }
];

/**
 * Quita tildes y baja a minúsculas para comparar.
 */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Devuelve el nombre canónico del banco. Si no encuentra match, devuelve el
 * original con limpieza básica (sin "S.A.", capitalizado, espacios normalizados).
 */
export function normalizeBancoName(raw: string | null | undefined): string {
  if (!raw) return "Sin banco";
  const cleaned = normalize(raw);
  if (!cleaned) return "Sin banco";

  for (const rule of BANK_RULES) {
    for (const p of rule.patterns) {
      if (p.test(cleaned)) return rule.canonical;
    }
  }

  // Fallback: limpiar sufijos y capitalizar
  return cleanupFallback(raw);
}

/**
 * Cleanup para nombres que no matchean ninguna regla: quitar S.A., S.A.U.,
 * S.R.L., etc., normalizar espacios, capitalizar cada palabra.
 */
function cleanupFallback(raw: string): string {
  let s = raw.replace(/\s+/g, " ").trim();
  s = s.replace(/\bs\.?\s?a\.?\s?u?\.?\s*$/i, "").trim();
  s = s.replace(/\bs\.?\s?r\.?\s?l\.?\s*$/i, "").trim();
  s = s.replace(/\bltd\.?\s*$/i, "").trim();
  if (!s) return "Sin banco";
  const short = new Set(["de", "del", "la", "las", "los", "y", "en"]);
  return s
    .toLowerCase()
    .split(" ")
    .map((w, i) => (i > 0 && short.has(w)) ? w : (w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

// ============================================================================
// Aprendizaje automático: fuzzy matching contra bancos ya existentes
// ============================================================================

/**
 * Similitud Jaro-Winkler entre dos strings (0.0 = totalmente distintos,
 * 1.0 = idénticos). Usada para detectar si un nombre nuevo es una variante
 * de uno ya existente sin depender de reglas hardcoded.
 */
function jaroSimilarity(s1: string, s2: string): number {
  if (s1 === s2) return 1;
  const len1 = s1.length;
  const len2 = s2.length;
  if (len1 === 0 || len2 === 0) return 0;

  const matchDistance = Math.floor(Math.max(len1, len2) / 2) - 1;
  const s1Matches = new Array(len1).fill(false);
  const s2Matches = new Array(len2).fill(false);
  let matches = 0;

  for (let i = 0; i < len1; i++) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(i + matchDistance + 1, len2);
    for (let j = start; j < end; j++) {
      if (s2Matches[j]) continue;
      if (s1[i] !== s2[j]) continue;
      s1Matches[i] = true;
      s2Matches[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;

  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < len1; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }
  transpositions /= 2;

  return (
    matches / len1 +
    matches / len2 +
    (matches - transpositions) / matches
  ) / 3;
}

function jaroWinklerSimilarity(s1: string, s2: string): number {
  const jaro = jaroSimilarity(s1, s2);
  // Bonus por prefijo común (hasta 4 caracteres)
  let prefix = 0;
  const maxPrefix = Math.min(4, s1.length, s2.length);
  for (let i = 0; i < maxPrefix; i++) {
    if (s1[i] === s2[i]) prefix++;
    else break;
  }
  return jaro + prefix * 0.1 * (1 - jaro);
}

/**
 * Devuelve las palabras "significativas" de un nombre de banco:
 * bajadas a minúsculas, sin tildes, sin stopwords ni palabras cortas.
 * Ej: "Banco de la Nación Argentina" → ["nacion", "argentina"]
 */
function significantTokens(name: string): string[] {
  const stopwords = new Set([
    "banco", "el", "la", "los", "las", "de", "del", "en", "y", "sa", "sau",
    "srl", "sac", "argentina", "argentino", "bank"
  ]);
  return normalize(name)
    .split(/\s+/)
    .filter(w => w.length >= 3 && !stopwords.has(w));
}

/**
 * Dado un nombre nuevo y una lista de nombres existentes, devuelve el existente
 * más similar si la similitud supera el umbral. Retorna null si ninguno es similar
 * suficiente. Combina Jaro-Winkler con overlap de tokens significativos para
 * evitar falsos positivos (ej. "Banco Provincia" ≠ "Banco Nación" aunque
 * comparten "banco").
 *
 * @param threshold umbral 0-1 (default 0.90, conservador para minimizar merges erróneos)
 */
export function findSimilarBank(
  newName: string,
  existingNames: string[],
  threshold: number = 0.90
): string | null {
  if (!newName || existingNames.length === 0) return null;

  const newTokens = new Set(significantTokens(newName));
  const newNorm = normalize(newName);

  let best: { name: string; score: number } | null = null;
  for (const existing of existingNames) {
    const existingTokens = new Set(significantTokens(existing));
    // Debe compartir al menos una palabra significativa (evita match espurio
    // solo por prefijos comunes como "Banco ")
    let sharedToken = false;
    for (const t of newTokens) if (existingTokens.has(t)) { sharedToken = true; break; }
    if (!sharedToken && newTokens.size > 0 && existingTokens.size > 0) continue;

    const score = jaroWinklerSimilarity(newNorm, normalize(existing));
    if (score >= threshold && (!best || score > best.score)) {
      best = { name: existing, score };
    }
  }
  return best ? best.name : null;
}

/**
 * Versión "inteligente" de normalizeBancoName que además consulta contra
 * los bancos ya conocidos para consolidar variantes automáticamente:
 *
 *   1. Aplica reglas hardcoded (casos comunes).
 *   2. Si el resultado NO coincide con ninguno de los existentes pero es "muy
 *      parecido" a uno, devuelve el existente para agrupar.
 *   3. Si es un banco totalmente nuevo, devuelve el nombre canónico normal.
 *
 * @param raw nombre crudo del extracto
 * @param existingNames nombres canónicos ya presentes en la BD (típicamente
 *                      los distintos valores de bank_statements.banco para
 *                      la empresa)
 */
export function normalizeBancoNameSmart(
  raw: string | null | undefined,
  existingNames: string[] = []
): string {
  const canonical = normalizeBancoName(raw);
  if (canonical === "Sin banco" || existingNames.length === 0) return canonical;
  if (existingNames.includes(canonical)) return canonical;
  const similar = findSimilarBank(canonical, existingNames);
  return similar ?? canonical;
}

/**
 * Dada una lista de nombres de banco crudos (posiblemente repetidos y con
 * variantes), devuelve un Map<nombreCrudo, nombreCanónico> que agrupa todas
 * las variantes similares bajo un mismo nombre.
 *
 * Uso típico en el server-side render: aplicar este mapa al hacer .map() sobre
 * los movimientos/statements que se le mandan al cliente, así el UI recibe
 * bancos ya consolidados sin necesidad de tocar la BD.
 *
 * Estrategia:
 *   1. Aplicar reglas hardcoded a cada nombre.
 *   2. Contar frecuencia de cada canónico.
 *   3. Buscar canónicos similares entre sí y colapsar bajo el más frecuente.
 */
export function groupBanks(rawNames: (string | null | undefined)[]): Map<string, string> {
  const result = new Map<string, string>();
  if (rawNames.length === 0) return result;

  // Step 1: canonicalizar
  const canonicals = new Map<string, string>();  // raw → canonical
  for (const raw of rawNames) {
    const key = raw ?? "";
    if (canonicals.has(key)) continue;
    canonicals.set(key, normalizeBancoName(raw));
  }

  // Step 2: contar frecuencia por canónico
  const freq = new Map<string, number>();
  for (const c of canonicals.values()) freq.set(c, (freq.get(c) ?? 0) + 1);

  // Step 3: consolidar canónicos similares entre sí
  const uniqueCanonicals = Array.from(freq.keys());
  const remap = new Map<string, string>();  // canonical → canonical ganador
  for (const c of uniqueCanonicals) {
    const others = uniqueCanonicals.filter(o => o !== c);
    const similar = findSimilarBank(c, others);
    if (similar) {
      const winner = (freq.get(similar) ?? 0) >= (freq.get(c) ?? 0) ? similar : c;
      const loser = winner === c ? similar : c;
      remap.set(loser, winner);
    }
  }
  // Resolver cadenas (A→B, B→C ⇒ A→C)
  for (const [k] of remap) {
    let v = remap.get(k)!;
    const visited = new Set<string>([k]);
    while (remap.has(v) && !visited.has(v)) { visited.add(v); v = remap.get(v)!; }
    remap.set(k, v);
  }

  // Step 4: componer raw → final
  for (const [raw, canonical] of canonicals) {
    const final = remap.get(canonical) ?? canonical;
    result.set(raw, final);
  }
  return result;
}
