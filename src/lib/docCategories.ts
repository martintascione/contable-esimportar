import type { DocCategory } from "./supabase/types";

export interface CategoryDef {
  key: DocCategory;
  label: string;
  descripcion: string;
  organismoSugerido?: string;
  requiereVencimiento?: boolean;
  grupo: "societario" | "fiscal" | "personal" | "operativo" | "contable" | "otro";
}

export const CATEGORIES: CategoryDef[] = [
  // Societario
  { key: "estatuto",         label: "Estatuto social",           descripcion: "Documento constitutivo de la sociedad",     grupo: "societario", organismoSugerido: "Escribanía / IGJ-DPPJ" },
  { key: "acta_constitutiva",label: "Acta constitutiva",         descripcion: "Acta de constitución original",             grupo: "societario" },
  { key: "acta_asamblea",    label: "Acta de asamblea",          descripcion: "Acta de asamblea ordinaria o extraordinaria", grupo: "societario" },
  { key: "acta_directorio",  label: "Acta de directorio",        descripcion: "Acta de reunión de directorio",              grupo: "societario" },
  { key: "inscripcion_dppj", label: "Inscripción DPPJ / IGJ",    descripcion: "Inscripción en Personas Jurídicas",         grupo: "societario", organismoSugerido: "DPPJ-PBA / IGJ" },
  { key: "poder",            label: "Poder",                     descripcion: "Poder general o especial",                  grupo: "societario", requiereVencimiento: true },

  // Fiscal — inscripciones y constancias permanentes (ARCA, IIBB, habilitaciones)
  { key: "constancia_cuit",  label: "Constancia de CUIT",        descripcion: "Constancia de inscripción AFIP (ARCA)",     grupo: "fiscal", organismoSugerido: "AFIP-ARCA" },
  { key: "inscripcion_arca", label: "Inscripción ARCA",          descripcion: "Inscripción en ARCA (ex AFIP)",              grupo: "fiscal", organismoSugerido: "AFIP-ARCA" },
  { key: "inscripcion_iibb", label: "Inscripción IIBB",          descripcion: "Inscripción en Ingresos Brutos",             grupo: "fiscal", organismoSugerido: "ARBA / AGIP / Rentas provincial" },
  { key: "libre_deuda",      label: "Libre deuda",               descripcion: "Libre deuda impositiva o municipal",         grupo: "fiscal", requiereVencimiento: true },
  { key: "certificado_pyme", label: "Certificado PyME",          descripcion: "Certificado MiPyME",                         grupo: "fiscal", requiereVencimiento: true, organismoSugerido: "SEPyME" },

  // Contable — documentos y DDJJ que genera o administra el contador
  { key: "libro_iva_digital",      label: "Libro IVA Digital",           descripcion: "Libro IVA Digital (LID) presentado mensualmente a ARCA", grupo: "contable", organismoSugerido: "AFIP-ARCA" },
  { key: "libro_iva_ventas",       label: "Libro IVA Ventas",            descripcion: "Libro IVA Ventas del período",                          grupo: "contable", organismoSugerido: "AFIP-ARCA" },
  { key: "libro_iva_compras",      label: "Libro IVA Compras",           descripcion: "Libro IVA Compras del período",                         grupo: "contable", organismoSugerido: "AFIP-ARCA" },
  { key: "ddjj_iva",               label: "DDJJ IVA (F.2002)",           descripcion: "Declaración jurada mensual de IVA",                     grupo: "contable", organismoSugerido: "AFIP-ARCA" },
  { key: "ddjj_ganancias",         label: "DDJJ Ganancias",              descripcion: "Declaración jurada anual de Impuesto a las Ganancias",  grupo: "contable", organismoSugerido: "AFIP-ARCA" },
  { key: "ddjj_bienes_personales", label: "DDJJ Bienes Personales",      descripcion: "Declaración jurada anual de Bienes Personales",         grupo: "contable", organismoSugerido: "AFIP-ARCA" },
  { key: "ddjj_iibb",              label: "DDJJ IIBB local",             descripcion: "Declaración jurada mensual de Ingresos Brutos (local)", grupo: "contable", organismoSugerido: "ARBA / AGIP / Rentas" },
  { key: "ddjj_iibb_cm",           label: "DDJJ IIBB Convenio Multilateral", descripcion: "Declaración jurada CM-05",                          grupo: "contable", organismoSugerido: "COMARB" },
  { key: "ddjj_monotributo",       label: "DDJJ / Recategorización Monotributo", descripcion: "Recategorización cuatrimestral",                grupo: "contable", organismoSugerido: "AFIP-ARCA" },
  { key: "ddjj_sicore",            label: "DDJJ SICORE",                 descripcion: "Régimen general de retenciones (F.744/F.997)",          grupo: "contable", organismoSugerido: "AFIP-ARCA" },
  { key: "ddjj_sicoss",            label: "DDJJ SICOSS",                 descripcion: "Seguridad social (F.931)",                              grupo: "contable", organismoSugerido: "AFIP-ARCA" },
  { key: "ddjj_f931",              label: "DDJJ F.931 (Cargas sociales)",descripcion: "Formulario 931 — cargas sociales",                      grupo: "contable", organismoSugerido: "AFIP-ARCA" },
  { key: "balance",                label: "Balance contable",            descripcion: "Balance contable anual firmado",                        grupo: "contable" },
  { key: "estados_financieros",    label: "Estados financieros",         descripcion: "EEFF completos con notas y anexos",                     grupo: "contable" },
  { key: "anexo_balance",          label: "Anexos del balance",          descripcion: "Anexos A, B, C, G, H del balance",                      grupo: "contable" },
  { key: "memoria",                label: "Memoria",                     descripcion: "Memoria del directorio al balance anual",               grupo: "contable" },
  { key: "informe_auditoria",      label: "Informe de auditoría",        descripcion: "Informe del contador sobre EEFF",                       grupo: "contable" },
  { key: "acta_asamblea_aprobacion_balance", label: "Acta aprobación balance", descripcion: "Acta de asamblea que aprueba el balance anual",    grupo: "contable" },
  { key: "papel_trabajo",          label: "Papel de trabajo",            descripcion: "Papeles de trabajo del contador",                       grupo: "contable" },
  { key: "conciliacion_bancaria_contable", label: "Conciliación bancaria (contable)", descripcion: "Conciliación bancaria mensual del contador", grupo: "contable" },
  { key: "vep_pago",               label: "VEP / Comprobante de pago",   descripcion: "Volante Electrónico de Pago o comprobante de pago de impuestos", grupo: "contable", organismoSugerido: "AFIP-ARCA" },
  { key: "cert_retencion_recibido",label: "Certificado de retención",    descripcion: "Certificado de retención sufrida",                      grupo: "contable" },
  { key: "planilla_rrhh",          label: "Planilla de RRHH / nómina",   descripcion: "Planilla de personal / nómina",                         grupo: "contable" },
  { key: "recibo_sueldo",          label: "Recibo de sueldo",            descripcion: "Recibo de sueldo firmado",                              grupo: "contable" },

  // Personal (socios / firmantes)
  { key: "dni_socio",        label: "DNI de socio",              descripcion: "Documento de identidad de socio o firmante", grupo: "personal", requiereVencimiento: true },
  { key: "firma_digital",    label: "Firma digital",             descripcion: "Token de firma digital registrado",          grupo: "personal", requiereVencimiento: true, organismoSugerido: "ONTI / AC-RAÍZ" },

  // Operativo
  { key: "habilitacion_municipal", label: "Habilitación municipal", descripcion: "Habilitación comercial o industrial",   grupo: "operativo", requiereVencimiento: true },
  { key: "contrato_alquiler", label: "Contrato de alquiler",      descripcion: "Contrato de locación comercial",             grupo: "operativo", requiereVencimiento: true },

  // Otro
  { key: "otro",             label: "Otro",                      descripcion: "Documento no categorizado",                  grupo: "otro" }
];

export const GRUPO_LABEL: Record<CategoryDef["grupo"], string> = {
  societario: "Societarios",
  fiscal:     "Fiscales e impositivos",
  contable:   "Documentos fiscales · Área contador",
  personal:   "Socios y firmantes",
  operativo:  "Operativos / habilitaciones",
  otro:       "Otros"
};

/** Subtítulo para cada grupo — se muestra debajo del título en Documentación */
export const GRUPO_SUBTITLE: Record<CategoryDef["grupo"], string> = {
  societario: "Documentos constitutivos, actas y poderes",
  fiscal:     "Inscripciones y constancias permanentes",
  contable:   "Área de carga de la Contadora: DDJJ, libros, balances, informes",
  personal:   "Documentación de socios, administradores y firmantes",
  operativo:  "Habilitaciones, contratos operativos",
  otro:       "Documentos no categorizados"
};

export function categoryByKey(key: DocCategory) {
  return CATEGORIES.find(c => c.key === key) ?? CATEGORIES[CATEGORIES.length - 1];
}
