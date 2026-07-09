-- =====================================================================
-- 0010 · Facturas en múltiples monedas
-- Guarda la moneda original y el tipo de cambio de cada factura.
-- Los importes en la DB se convierten a ARS al momento de ingest para
-- que Dashboard IVA y Balances sigan funcionando en pesos.
-- =====================================================================

alter table public.invoices
  add column if not exists moneda          text          default 'ARS' not null,
  add column if not exists tipo_cambio     numeric(18,4) default 1     not null,
  -- Importes en la moneda original (opcionales, útiles para mostrar en el detalle)
  add column if not exists total_moneda_original       numeric(18,2),
  add column if not exists neto_moneda_original        numeric(18,2),
  add column if not exists iva_total_moneda_original   numeric(18,2);

create index if not exists invoices_moneda_idx on public.invoices(moneda);
