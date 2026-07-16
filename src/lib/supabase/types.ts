/**
 * Tipos mínimos de la DB. Para regenerarlos con la CLI:
 *   supabase gen types typescript --project-id <id> > src/lib/supabase/types.ts
 */

export type UserRole = "admin" | "contador";
export type InvoiceType = "venta" | "compra";
export type InvoiceStatus = "pendiente" | "aprobada" | "revision" | "rechazada";
export type MovementType = "ingreso" | "egreso";
export type MovementStatus = "conciliado" | "pendiente" | "impuesto" | "gasto_bancario";
export type DocCategory =
  // Societario
  | "estatuto" | "acta_constitutiva" | "acta_asamblea" | "acta_directorio"
  | "inscripcion_dppj" | "poder"
  // Fiscal (inscripciones permanentes)
  | "constancia_cuit" | "inscripcion_arca" | "inscripcion_iibb"
  | "libre_deuda" | "certificado_pyme"
  // Contable (área contador)
  | "libro_iva_digital" | "libro_iva_ventas" | "libro_iva_compras"
  | "ddjj_iva" | "ddjj_ganancias" | "ddjj_bienes_personales"
  | "ddjj_iibb" | "ddjj_iibb_cm" | "ddjj_monotributo"
  | "ddjj_sicore" | "ddjj_sicoss" | "ddjj_f931"
  | "balance" | "estados_financieros" | "anexo_balance" | "memoria"
  | "informe_auditoria" | "acta_asamblea_aprobacion_balance"
  | "papel_trabajo" | "conciliacion_bancaria_contable"
  | "vep_pago" | "cert_retencion_recibido"
  | "planilla_rrhh" | "recibo_sueldo"
  // Personal
  | "dni_socio" | "firma_digital"
  // Operativo
  | "habilitacion_municipal" | "contrato_alquiler"
  // Otro
  | "otro";

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  role: UserRole;
  company_id: string | null;
  created_at: string;
}

export interface Company {
  id: string;
  razon_social: string;
  cuit: string;
  condicion_iva: string | null;
  iibb: string | null;
  actividad: string | null;
  direccion: string | null;
  owner_id: string | null;
  public_slug?: string | null;
  public_enabled?: boolean | null;
  public_published_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Invoice {
  id: string;
  company_id: string;
  tipo: InvoiceType;
  fecha: string;
  razon_social: string;
  cuit: string | null;
  comprobante: string | null;
  punto_venta: string | null;
  numero: string | null;
  neto_gravado: number;
  iva_21: number;
  iva_10_5: number;
  iva_27: number;
  iva_otros: number;
  iva_total: number;
  percepciones: number;
  total: number;
  cae: string | null;
  storage_path: string | null;
  original_filename?: string | null;
  moneda?: "ARS" | "USD" | "EUR" | "OTRA" | null;
  tipo_cambio?: number | null;
  total_moneda_original?: number | null;
  neto_moneda_original?: number | null;
  iva_total_moneda_original?: number | null;
  ai_metadata: Record<string, unknown> | null;
  ai_confidence: number | null;
  status: InvoiceStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type BankCurrency = "ARS" | "USD" | "EUR" | "OTRA";

export interface BankStatement {
  id: string;
  company_id: string;
  banco: string;
  cuenta: string | null;
  cbu: string | null;
  periodo_desde: string | null;
  periodo_hasta: string | null;
  storage_path: string | null;
  original_filename?: string | null;
  moneda?: BankCurrency;
  ai_metadata: Record<string, unknown> | null;
  created_by: string | null;
  created_at: string;
}

export interface BankMovement {
  id: string;
  company_id: string;
  statement_id: string | null;
  fecha: string;
  descripcion: string;
  tipo: MovementType;
  monto: number;
  estado: MovementStatus;
  invoice_id: string | null;
  referencia: string | null;
  moneda?: BankCurrency;
  tipo_cambio_referencia?: number | null;
  tipo_cambio_referencia_fuente?: "bcra" | "manual" | null;
  created_at: string;
}

export interface CompanyDocument {
  id: string;
  company_id: string;
  categoria: DocCategory;
  nombre: string;
  descripcion: string | null;
  numero: string | null;
  organismo: string | null;
  fecha_emision: string | null;
  fecha_vencimiento: string | null;
  vinculado_a: string | null;
  storage_path: string | null;
  mime_type: string | null;
  tamano_bytes: number | null;
  notas: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Integration {
  id: string;
  company_id: string;
  provider: string;
  status: "connected" | "disconnected" | "error";
  config: Record<string, unknown> | null;
  connected_at: string | null;
  created_at: string;
}

// Shape mínimo usado por los helpers de supabase-js
export type Database = {
  public: {
    Tables: {
      profiles: { Row: Profile; Insert: Partial<Profile> & { id: string }; Update: Partial<Profile> };
      companies: { Row: Company; Insert: Partial<Company> & { razon_social: string; cuit: string }; Update: Partial<Company> };
      invoices: { Row: Invoice; Insert: Partial<Invoice> & { company_id: string; tipo: InvoiceType; fecha: string; razon_social: string }; Update: Partial<Invoice> };
      bank_statements: { Row: BankStatement; Insert: Partial<BankStatement> & { company_id: string; banco: string }; Update: Partial<BankStatement> };
      bank_movements: { Row: BankMovement; Insert: Partial<BankMovement> & { company_id: string; fecha: string; descripcion: string; tipo: MovementType; monto: number }; Update: Partial<BankMovement> };
      company_documents: { Row: CompanyDocument; Insert: Partial<CompanyDocument> & { company_id: string; categoria: DocCategory; nombre: string }; Update: Partial<CompanyDocument> };
      integrations: { Row: Integration; Insert: Partial<Integration> & { company_id: string; provider: string }; Update: Partial<Integration> };
    };
  };
};
