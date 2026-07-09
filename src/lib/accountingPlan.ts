/**
 * Plan de cuentas estándar para PyMEs argentinas.
 * Las imputables son las hojas (no agrupadores).
 */

export type AccountSeed = {
  code: string;
  name: string;
  type: "activo" | "pasivo" | "patrimonio_neto" | "ingreso" | "egreso";
  is_imputable: boolean;
  parent_code?: string | null;
};

export const DEFAULT_PLAN: AccountSeed[] = [
  // ─── ACTIVO ────────────────────────────────────────────
  { code: "1",        name: "ACTIVO",                              type: "activo", is_imputable: false },
  { code: "1.1",      name: "Activo Corriente",                    type: "activo", is_imputable: false, parent_code: "1" },
  { code: "1.1.01",   name: "Caja",                                type: "activo", is_imputable: true,  parent_code: "1.1" },
  { code: "1.1.02",   name: "Caja en USD",                         type: "activo", is_imputable: true,  parent_code: "1.1" },
  { code: "1.1.10",   name: "Banco Macro CC ARS",                  type: "activo", is_imputable: true,  parent_code: "1.1" },
  { code: "1.1.11",   name: "Banco Galicia CC ARS",                type: "activo", is_imputable: true,  parent_code: "1.1" },
  { code: "1.1.12",   name: "Mercado Pago",                        type: "activo", is_imputable: true,  parent_code: "1.1" },
  { code: "1.1.20",   name: "Deudores por ventas",                 type: "activo", is_imputable: true,  parent_code: "1.1" },
  { code: "1.1.21",   name: "Deudores varios",                     type: "activo", is_imputable: true,  parent_code: "1.1" },
  { code: "1.1.30",   name: "IVA Crédito Fiscal",                  type: "activo", is_imputable: true,  parent_code: "1.1" },
  { code: "1.1.31",   name: "Retenciones IVA sufridas",            type: "activo", is_imputable: true,  parent_code: "1.1" },
  { code: "1.1.32",   name: "Percepciones IVA sufridas",           type: "activo", is_imputable: true,  parent_code: "1.1" },
  { code: "1.1.33",   name: "Percepciones IIBB sufridas",          type: "activo", is_imputable: true,  parent_code: "1.1" },
  { code: "1.1.34",   name: "Retenciones Ganancias sufridas",      type: "activo", is_imputable: true,  parent_code: "1.1" },
  { code: "1.1.35",   name: "Impuesto Ley 25.413 a cuenta Gcias",  type: "activo", is_imputable: true,  parent_code: "1.1" },
  { code: "1.1.40",   name: "Anticipos a proveedores",             type: "activo", is_imputable: true,  parent_code: "1.1" },
  { code: "1.1.50",   name: "Bienes de cambio (mercadería)",       type: "activo", is_imputable: true,  parent_code: "1.1" },
  { code: "1.1.60",   name: "Cuenta particular socios (deudora)",  type: "activo", is_imputable: true,  parent_code: "1.1" },

  { code: "1.2",      name: "Activo No Corriente",                 type: "activo", is_imputable: false, parent_code: "1" },
  { code: "1.2.01",   name: "Bienes de uso · Rodados",             type: "activo", is_imputable: true,  parent_code: "1.2" },
  { code: "1.2.02",   name: "Bienes de uso · Equipos",             type: "activo", is_imputable: true,  parent_code: "1.2" },
  { code: "1.2.03",   name: "Bienes de uso · Inmuebles",           type: "activo", is_imputable: true,  parent_code: "1.2" },
  { code: "1.2.10",   name: "Amortizaciones acumuladas",           type: "activo", is_imputable: true,  parent_code: "1.2" },

  // ─── PASIVO ─────────────────────────────────────────────
  { code: "2",        name: "PASIVO",                              type: "pasivo", is_imputable: false },
  { code: "2.1",      name: "Pasivo Corriente",                    type: "pasivo", is_imputable: false, parent_code: "2" },
  { code: "2.1.01",   name: "Proveedores",                         type: "pasivo", is_imputable: true,  parent_code: "2.1" },
  { code: "2.1.10",   name: "IVA Débito Fiscal",                   type: "pasivo", is_imputable: true,  parent_code: "2.1" },
  { code: "2.1.11",   name: "IVA a pagar",                         type: "pasivo", is_imputable: true,  parent_code: "2.1" },
  { code: "2.1.12",   name: "IIBB a pagar",                        type: "pasivo", is_imputable: true,  parent_code: "2.1" },
  { code: "2.1.13",   name: "Impuesto Ganancias a pagar",          type: "pasivo", is_imputable: true,  parent_code: "2.1" },
  { code: "2.1.14",   name: "Otros impuestos a pagar",             type: "pasivo", is_imputable: true,  parent_code: "2.1" },
  { code: "2.1.20",   name: "Sueldos a pagar",                     type: "pasivo", is_imputable: true,  parent_code: "2.1" },
  { code: "2.1.21",   name: "Cargas sociales a pagar",             type: "pasivo", is_imputable: true,  parent_code: "2.1" },
  { code: "2.1.30",   name: "Anticipos de clientes",               type: "pasivo", is_imputable: true,  parent_code: "2.1" },
  { code: "2.1.40",   name: "Cuenta particular socios (acreedora)",type: "pasivo", is_imputable: true,  parent_code: "2.1" },
  { code: "2.1.50",   name: "Préstamos bancarios",                 type: "pasivo", is_imputable: true,  parent_code: "2.1" },

  // ─── PATRIMONIO NETO ───────────────────────────────────
  { code: "3",        name: "PATRIMONIO NETO",                     type: "patrimonio_neto", is_imputable: false },
  { code: "3.1.01",   name: "Capital social",                      type: "patrimonio_neto", is_imputable: true, parent_code: "3" },
  { code: "3.1.02",   name: "Aportes irrevocables",                type: "patrimonio_neto", is_imputable: true, parent_code: "3" },
  { code: "3.1.10",   name: "Resultados acumulados",               type: "patrimonio_neto", is_imputable: true, parent_code: "3" },
  { code: "3.1.11",   name: "Resultado del ejercicio",             type: "patrimonio_neto", is_imputable: true, parent_code: "3" },

  // ─── INGRESOS / RESULTADOS POSITIVOS ───────────────────
  { code: "4",        name: "INGRESOS",                            type: "ingreso", is_imputable: false },
  { code: "4.1.01",   name: "Ventas mercadería",                   type: "ingreso", is_imputable: true, parent_code: "4" },
  { code: "4.1.02",   name: "Ventas servicios",                    type: "ingreso", is_imputable: true, parent_code: "4" },
  { code: "4.1.03",   name: "Devoluciones y bonificaciones",       type: "ingreso", is_imputable: true, parent_code: "4" },
  { code: "4.1.10",   name: "Intereses ganados",                   type: "ingreso", is_imputable: true, parent_code: "4" },
  { code: "4.1.11",   name: "Diferencia de cambio positiva",       type: "ingreso", is_imputable: true, parent_code: "4" },
  { code: "4.1.20",   name: "Otros ingresos",                      type: "ingreso", is_imputable: true, parent_code: "4" },

  // ─── EGRESOS / RESULTADOS NEGATIVOS ────────────────────
  { code: "5",        name: "EGRESOS",                             type: "egreso", is_imputable: false },
  { code: "5.1",      name: "Costo de venta",                      type: "egreso", is_imputable: false, parent_code: "5" },
  { code: "5.1.01",   name: "Compras / costo mercadería",          type: "egreso", is_imputable: true,  parent_code: "5.1" },
  { code: "5.1.02",   name: "Fletes y acarreos",                   type: "egreso", is_imputable: true,  parent_code: "5.1" },

  { code: "5.2",      name: "Gastos operativos",                   type: "egreso", is_imputable: false, parent_code: "5" },
  { code: "5.2.01",   name: "Sueldos",                             type: "egreso", is_imputable: true,  parent_code: "5.2" },
  { code: "5.2.02",   name: "Cargas sociales",                     type: "egreso", is_imputable: true,  parent_code: "5.2" },
  { code: "5.2.03",   name: "Honorarios profesionales",            type: "egreso", is_imputable: true,  parent_code: "5.2" },
  { code: "5.2.10",   name: "Alquileres",                          type: "egreso", is_imputable: true,  parent_code: "5.2" },
  { code: "5.2.11",   name: "Servicios públicos (luz/gas/agua)",   type: "egreso", is_imputable: true,  parent_code: "5.2" },
  { code: "5.2.12",   name: "Telefonía e internet",                type: "egreso", is_imputable: true,  parent_code: "5.2" },
  { code: "5.2.13",   name: "Insumos y limpieza",                  type: "egreso", is_imputable: true,  parent_code: "5.2" },
  { code: "5.2.14",   name: "Mantenimiento y reparaciones",        type: "egreso", is_imputable: true,  parent_code: "5.2" },
  { code: "5.2.20",   name: "Publicidad y marketing",              type: "egreso", is_imputable: true,  parent_code: "5.2" },
  { code: "5.2.30",   name: "Movilidad y viáticos",                type: "egreso", is_imputable: true,  parent_code: "5.2" },

  { code: "5.3",      name: "Gastos financieros y bancarios",      type: "egreso", is_imputable: false, parent_code: "5" },
  { code: "5.3.01",   name: "Intereses pagados",                   type: "egreso", is_imputable: true,  parent_code: "5.3" },
  { code: "5.3.02",   name: "Comisiones bancarias",                type: "egreso", is_imputable: true,  parent_code: "5.3" },
  { code: "5.3.03",   name: "Mantenimiento de cuenta",             type: "egreso", is_imputable: true,  parent_code: "5.3" },
  { code: "5.3.04",   name: "Impuesto Ley 25.413 (IDB)",           type: "egreso", is_imputable: true,  parent_code: "5.3" },
  { code: "5.3.05",   name: "Diferencia de cambio negativa",       type: "egreso", is_imputable: true,  parent_code: "5.3" },

  { code: "5.4",      name: "Impuestos",                           type: "egreso", is_imputable: false, parent_code: "5" },
  { code: "5.4.01",   name: "IIBB local",                          type: "egreso", is_imputable: true,  parent_code: "5.4" },
  { code: "5.4.02",   name: "IIBB Convenio Multilateral",          type: "egreso", is_imputable: true,  parent_code: "5.4" },
  { code: "5.4.03",   name: "Impuestos municipales",               type: "egreso", is_imputable: true,  parent_code: "5.4" },
  { code: "5.4.99",   name: "Otros impuestos",                     type: "egreso", is_imputable: true,  parent_code: "5.4" },

  { code: "5.5.01",   name: "Amortización de bienes de uso",       type: "egreso", is_imputable: true,  parent_code: "5" },
  { code: "5.9.99",   name: "Otros gastos varios",                 type: "egreso", is_imputable: true,  parent_code: "5" }
];
