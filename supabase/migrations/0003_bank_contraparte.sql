-- =====================================================================
-- 0003 · Contraparte en movimientos bancarios
-- Identifica el CUIT y nombre de la contraparte en cada movimiento
-- y marca si es una transferencia a/desde cuenta propia.
-- =====================================================================

alter table public.bank_movements
  add column if not exists cuit_contraparte    text,
  add column if not exists nombre_contraparte  text,
  add column if not exists es_transferencia    boolean default false,
  add column if not exists es_cuenta_propia    boolean default false;

create index if not exists bank_movements_cuit_contraparte_idx
  on public.bank_movements(cuit_contraparte);

create index if not exists bank_movements_es_propia_idx
  on public.bank_movements(es_cuenta_propia);
