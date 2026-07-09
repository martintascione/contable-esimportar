import crypto from "node:crypto";
import { anthropic, ANTHROPIC_MODEL } from "./client";
import { createAdminClient } from "@/lib/supabase/server";
import {
  INVOICE_SYSTEM, INVOICE_USER_HINT,
  INVOICE_LIST_SYSTEM, INVOICE_LIST_USER_HINT,
  BANK_SYSTEM, BANK_USER_HINT,
  COMPANY_DATA_SYSTEM, COMPANY_DATA_USER_HINT,
  DOC_CATEGORIZE_SYSTEM, DOC_CATEGORIZE_USER_HINT
} from "./prompts";

type Source =
  | { type: "image"; mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif"; base64: string }
  | { type: "pdf"; base64: string };

type ModelTier = "fast" | "precise" | "premium";

/** Devuelve el modelo a usar según el tier solicitado y env vars */
function modelFor(tier: ModelTier): string {
  const fast    = process.env.ANTHROPIC_MODEL_FAST    || process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001";
  const precise = process.env.ANTHROPIC_MODEL_PRECISE || process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";
  const premium = process.env.ANTHROPIC_MODEL_PREMIUM || "claude-opus-4-6";
  if (tier === "fast")    return fast;
  if (tier === "precise") return precise;
  return premium;
}

function hashSource(src: Source, kind: string, model: string): string {
  const h = crypto.createHash("sha256");
  h.update(kind);
  h.update("|");
  h.update(model);
  h.update("|");
  h.update(src.type);
  h.update("|");
  h.update(src.base64);
  return h.digest("hex");
}

async function getFromCache(hash: string): Promise<any | null> {
  try {
    const admin = createAdminClient();
    const { data } = await admin.from("ai_cache").select("response").eq("hash", hash).maybeSingle();
    return data?.response ?? null;
  } catch { return null; }
}

async function saveToCache(hash: string, kind: string, model: string, response: any, bytesSize: number) {
  try {
    const admin = createAdminClient();
    await admin.from("ai_cache").upsert({
      hash, kind, model, response, bytes_size: bytesSize
    }, { onConflict: "hash" });
  } catch {}
}

async function callClaude(
  systemPrompt: string,
  userHint: string,
  src: Source,
  opts: { kind: string; tier?: ModelTier; maxTokens?: number; useCache?: boolean } = { kind: "invoice" }
) {
  const tier = opts.tier ?? "fast";
  const maxTokens = opts.maxTokens ?? 4096;
  const useCache = opts.useCache !== false;
  const model = modelFor(tier);

  // 1) Buscar en cache por hash (key = kind + model + archivo)
  const hash = hashSource(src, opts.kind, model);
  if (useCache) {
    const cached = await getFromCache(hash);
    if (cached) return cached;
  }

  // 2) Armar contenido. Habilitamos prompt caching del system prompt para
  //    bajar el costo de tokens repetidos en llamadas consecutivas.
  const content: any[] =
    src.type === "image"
      ? [{ type: "image", source: { type: "base64", media_type: src.mediaType, data: src.base64 } }]
      : [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: src.base64 } }];
  content.push({ type: "text", text: userHint });

  const res = await anthropic().messages.create({
    model,
    max_tokens: maxTokens,
    temperature: 0,
    system: [
      // Prompt caching ephemeral — Anthropic cachea el system por 5 min y los hits cuestan ~10% del costo normal.
      { type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } as any }
    ] as any,
    messages: [{ role: "user", content }]
  });

  const text = res.content
    .map((c: any) => (c.type === "text" ? c.text : ""))
    .join("")
    .trim();

  const firstBrace = text.indexOf("{");
  if (firstBrace < 0) throw new Error("Respuesta del modelo sin JSON");

  const lastBrace = text.lastIndexOf("}");
  let parsed: any = null;
  if (lastBrace > firstBrace) {
    try { parsed = JSON.parse(text.slice(firstBrace, lastBrace + 1)); } catch {}
  }
  if (!parsed) {
    const repaired = repairTruncatedJson(text.slice(firstBrace));
    if (repaired) {
      try { parsed = JSON.parse(repaired); } catch {}
    }
  }
  if (!parsed) {
    const stopReason = (res as any).stop_reason ?? "unknown";
    throw new Error(
      `La IA no pudo generar una respuesta válida (stop_reason=${stopReason}). ` +
      `Causas posibles: documento ilegible, no es el tipo esperado, o muy largo.`
    );
  }

  // 3) Guardar en cache
  if (useCache) {
    const bytesSize = Math.floor((src.base64.length * 3) / 4);
    saveToCache(hash, opts.kind, model, parsed, bytesSize).catch(() => {});
  }

  return parsed;
}

function repairTruncatedJson(s: string): string | null {
  let out = "";
  const stack: string[] = [];
  let inString = false;
  let escape = false;
  let lastSafeLen = 0;
  let lastSafeStack: string[] = [];

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    out += ch;
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;

    if (ch === "{" || ch === "[") stack.push(ch);
    else if (ch === "}" || ch === "]") stack.pop();
    else if (ch === "," && stack[stack.length - 1] === "[") {
      lastSafeLen = out.length - 1;
      lastSafeStack = [...stack];
    }
  }

  if (!inString && stack.length === 0) return out;

  let work = lastSafeLen > 0 ? out.slice(0, lastSafeLen) : out;
  let workStack = lastSafeLen > 0 ? [...lastSafeStack] : [...stack];
  if (inString && lastSafeLen === 0) work += '"';
  while (workStack.length) {
    const open = workStack.pop();
    work += open === "{" ? "}" : "]";
  }
  return work;
}

// ---------------------------------------------------------------------
// Funciones públicas — todas usan tier "fast" (Haiku) por default.
// ---------------------------------------------------------------------

export async function extractInvoice(src: Source, tier: ModelTier = "fast") {
  return callClaude(INVOICE_SYSTEM, INVOICE_USER_HINT, src, {
    kind: "invoice", tier, maxTokens: 4096
  }) as Promise<InvoiceExtraction>;
}

export async function extractInvoiceList(src: Source, tier: ModelTier = "fast") {
  return callClaude(INVOICE_LIST_SYSTEM, INVOICE_LIST_USER_HINT, src, {
    kind: "invoice_list", tier, maxTokens: 32768
  }) as Promise<InvoiceListExtraction>;
}

export async function extractBankStatement(src: Source, tier: ModelTier = "fast") {
  return callClaude(BANK_SYSTEM, BANK_USER_HINT, src, {
    kind: "bank", tier, maxTokens: 16384
  }) as Promise<BankExtraction>;
}

export async function extractCompanyData(src: Source, tier: ModelTier = "fast") {
  return callClaude(COMPANY_DATA_SYSTEM, COMPANY_DATA_USER_HINT, src, {
    kind: "company_data", tier, maxTokens: 4096
  }) as Promise<CompanyDataExtraction>;
}

export async function categorizeDocument(src: Source, tier: ModelTier = "fast") {
  return callClaude(DOC_CATEGORIZE_SYSTEM, DOC_CATEGORIZE_USER_HINT, src, {
    kind: "doc_categorize", tier, maxTokens: 1024
  }) as Promise<DocCategorization>;
}

// ---------------------------------------------------------------------
// Tipos (igual que antes)
// ---------------------------------------------------------------------
export interface TaxLine {
  tipo:
    | "iva" | "percepcion_iva" | "percepcion_iibb" | "percepcion_suss"
    | "percepcion_ganancias" | "retencion_iva" | "retencion_ganancias"
    | "impuesto_interno" | "sircreb" | "otro";
  descripcion: string;
  alicuota: number | null;
  jurisdiccion: string | null;
  monto: number;
}

export interface InvoiceItem {
  descripcion: string;
  cantidad: number | null;
  precio_unitario: number | null;
  subtotal: number | null;
  alicuota_iva: number | null;
}

export interface InvoiceExtraction {
  tipo_comprobante: "FA" | "FB" | "FC" | "NC" | "ND" | "R" | "OTRO";
  letra: "A" | "B" | "C" | "M" | "E" | null;
  punto_venta: string | null;
  numero: string | null;
  comprobante: string | null;
  fecha_emision: string | null;
  fecha_vencimiento_pago: string | null;
  emisor: { razon_social: string | null; cuit: string | null; condicion_iva: string | null; domicilio?: string | null; iibb?: string | null };
  receptor: { razon_social: string | null; cuit: string | null; condicion_iva: string | null; domicilio?: string | null };
  moneda: "ARS" | "USD" | "OTRA" | null;
  tipo_cambio: number | null;
  neto_gravado: number;
  neto_no_gravado: number;
  exento: number;
  total_antes_impuestos: number;
  iva_21: number;
  iva_10_5: number;
  iva_27: number;
  iva_5: number;
  iva_2_5: number;
  iva_otros: number;
  iva_total: number;
  desglose_impuestos: TaxLine[];
  percepciones_total: number;
  retenciones_total: number;
  impuestos_internos_total: number;
  otros_impuestos_total: number;
  total: number;
  items: InvoiceItem[];
  forma_pago: string | null;
  cae: string | null;
  cae_vencimiento: string | null;
  confidence: number;
  validacion_suma: boolean;
  warnings: string[];
  percepciones?: number;
}

export interface InvoiceListRow {
  fecha_emision: string;
  tipo_comprobante: "FA" | "FB" | "FC" | "NC" | "ND" | "FE" | "OTRO";
  letra: "A" | "B" | "C" | "E" | null;
  codigo_tipo_afip: number | null;
  punto_venta: string | null;
  numero: string | null;
  comprobante: string | null;
  cae: string | null;
  cuit_emisor: string;
  razon_social_emisor: string;
  neto_gravado: number;
  neto_no_gravado: number;
  exento: number;
  otros_tributos: number;
  iva_total: number;
  total: number;
  moneda?: "ARS" | "USD" | "EUR" | "OTRA" | null;
  tipo_cambio?: number | null;
}

export interface InvoiceListExtraction {
  es_listado: true;
  tipo_listado: "recibidos" | "emitidos";
  cuit_titular: string | null;
  facturas: InvoiceListRow[];
  confidence: number;
  warnings: string[];
}

export interface DocCategorization {
  categoria:
    | "estatuto" | "acta_constitutiva" | "acta_asamblea" | "acta_directorio"
    | "dni_socio" | "firma_digital"
    | "inscripcion_arca" | "inscripcion_dppj" | "inscripcion_iibb"
    | "constancia_cuit" | "habilitacion_municipal" | "poder"
    | "libre_deuda" | "balance" | "ddjj_ganancias" | "ddjj_iva"
    | "certificado_pyme" | "contrato_alquiler" | "otro";
  nombre_sugerido: string;
  descripcion: string | null;
  numero: string | null;
  organismo: string | null;
  fecha_emision: string | null;
  fecha_vencimiento: string | null;
  vinculado_a: string | null;
  cuit_empresa: string | null;
  confidence: number;
  warnings: string[];
}

export interface CompanyDataExtraction {
  razon_social: string | null;
  nombre_fantasia: string | null;
  cuit: string | null;
  condicion_iva: string | null;
  iibb: string | null;
  iibb_jurisdiccion: string | null;
  actividad_principal: string | null;
  codigo_actividad: string | null;
  fecha_inscripcion: string | null;
  fecha_inicio_actividades: string | null;
  direccion_fiscal: string | null;
  provincia: string | null;
  localidad: string | null;
  codigo_postal: string | null;
  tipo_documento_detectado:
    | "constancia_cuit" | "inscripcion_arca" | "inscripcion_dppj"
    | "inscripcion_iibb" | "estatuto" | "otro";
  confidence: number;
  warnings: string[];
}

export interface BankExtraction {
  banco: string;
  cuenta: string | null;
  cbu: string | null;
  titular: string | null;
  cuit_titular: string | null;
  periodo_desde: string | null;
  periodo_hasta: string | null;
  saldo_inicial: number | null;
  saldo_final: number | null;
  moneda: "ARS" | "USD" | null;
  movimientos: {
    fecha: string;
    descripcion: string;
    tipo: "ingreso" | "egreso";
    monto: number;
    referencia: string | null;
    cuit_contraparte: string | null;
    nombre_contraparte: string | null;
    es_transferencia: boolean;
    cbu_contraparte?: string | null;
    categoria:
      | "transferencia" | "pago_proveedor" | "cobro_cliente"
      | "impuesto_ley_25413" | "comision" | "sircreb"
      | "interes" | "retencion_iva" | "retencion_ganancias"
      | "debito_automatico" | "otro";
    categoria_detalle?: string;
    jurisdiccion?: string | null;
    alicuota?: number | null;
  }[];
  confidence: number;
  warnings: string[];
}
