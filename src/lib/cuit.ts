/**
 * Helpers para CUIT argentino y detección de contraparte en descripciones bancarias.
 */

/** Devuelve solo los dígitos del string */
export function onlyDigits(s?: string | null) {
  return (s ?? "").replace(/\D+/g, "");
}

/** Validación checksum de CUIT argentino (11 dígitos) */
export function isValidCuit(cuit: string): boolean {
  const c = onlyDigits(cuit);
  if (c.length !== 11) return false;
  const mul = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  let acc = 0;
  for (let i = 0; i < 10; i++) acc += parseInt(c[i], 10) * mul[i];
  const mod = acc % 11;
  const dv = mod === 0 ? 0 : mod === 1 ? 9 : 11 - mod;
  return dv === parseInt(c[10], 10);
}

/** Formatea CUIT 11 dígitos como XX-XXXXXXXX-X */
export function formatCuit(cuit?: string | null) {
  const c = onlyDigits(cuit);
  if (c.length !== 11) return cuit ?? "";
  return `${c.slice(0,2)}-${c.slice(2,10)}-${c.slice(10)}`;
}

/**
 * Busca un CUIT en una descripción bancaria.
 * Estrategias (en orden):
 *   1. Un bloque de 11 dígitos contiguos que pase validación checksum.
 *   2. Formato "XX-XXXXXXXX-X".
 *   3. En referencias tipo "TRANSF:<22 dígitos CBU>-<11 dígitos>", los 11 del final.
 */
export function findCuitInText(text?: string | null): string | null {
  if (!text) return null;
  const t = text.toString();

  // 1) CUIT con guiones
  const withDashes = t.match(/\b(\d{2})-(\d{8})-(\d{1})\b/);
  if (withDashes) {
    const c = withDashes[1] + withDashes[2] + withDashes[3];
    if (isValidCuit(c)) return c;
  }

  // 2) TRANSF:<22dig>-<11dig> → sacar los últimos 11
  const transfMatch = t.match(/\b(\d{22})[- :](\d{11})\b/);
  if (transfMatch && isValidCuit(transfMatch[2])) return transfMatch[2];

  // 3) Cualquier bloque de 11 dígitos contiguos válidos
  const all11 = t.match(/\b\d{11}\b/g) ?? [];
  for (const candidate of all11) {
    if (isValidCuit(candidate)) return candidate;
  }

  // 4) Heurística: 11 dígitos sin borde claro, al final de la descripción
  const trailing = t.match(/(\d{11})\s*$/);
  if (trailing && isValidCuit(trailing[1])) return trailing[1];

  return null;
}

/**
 * Remueve del texto un CUIT ya detectado para generar un "nombre_contraparte" más limpio.
 */
export function removeCuitFromText(text: string, cuit: string): string {
  const c = onlyDigits(cuit);
  const f = formatCuit(cuit);
  return text
    .replaceAll(c, "")
    .replaceAll(f, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Detecta si una descripción representa una transferencia / TEF / MEP */
export function looksLikeTransfer(desc?: string | null): boolean {
  if (!desc) return false;
  const s = desc.toUpperCase();
  return /(TEF|TRANSF|MEP|CVU|TRANSFER|INTERBANC|ENVIO|RECEP)/.test(s);
}
