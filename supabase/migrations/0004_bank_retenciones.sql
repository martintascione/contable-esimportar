-- =====================================================================
-- 0004 · Retenciones y percepciones bancarias
-- Amplía la clasificación de movimientos para computar IVA crédito
-- bancario e IIBB crédito por jurisdicción.
-- =====================================================================

alter table public.bank_movements
  add column if not exists categoria_detalle text,
  add column if not exists jurisdiccion       text,
  add column if not exists alicuota           numeric;

-- categoria_detalle: string libre, normalmente uno de:
--   'retencion_iva'              → crédito IVA computable
--   'retencion_debito_fiscal'    → crédito en DDJJ IVA
--   'percepcion_iibb'            → crédito IIBB
--   'percepcion_iva'             → crédito IVA
--   'mantenimiento_cuenta'       → gasto bancario (deducible)
--   'comision_bancaria'          → gasto bancario
--   'impuesto_ley_25413'         → (IDB / crédito y débito bancario)
--   'sircreb'                    → SIRCREB BCRA (IIBB)
--   'retencion_ganancias'        → crédito Ganancias
--   'otro'

-- jurisdiccion: para percepciones IIBB, tipo 'CABA', 'Buenos Aires',
-- 'Córdoba', 'Santa Fe', 'Convenio Multilateral', etc. null para impuestos nacionales.

-- alicuota: porcentaje aplicado (ej 3.5 para percepción IIBB 3.5%). Opcional.

create index if not exists bank_movements_categoria_detalle_idx
  on public.bank_movements(categoria_detalle);
create index if not exists bank_movements_jurisdiccion_idx
  on public.bank_movements(jurisdiccion);
