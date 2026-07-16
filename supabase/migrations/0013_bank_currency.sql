-- ============================================================================
-- 0013 · Multi-moneda en movimientos bancarios (modelo simplificado)
-- ============================================================================
--
-- Objetivo:
--   Soportar cuentas bancarias en USD/EUR SIN convertir a ARS.
--   Los movimientos quedan en su moneda original. Solo guardamos el TC del
--   día del BCRA como REFERENCIA INFORMATIVA (para que el contador vea
--   "ese día el USD estaba a $1250"), pero no se usa para sumar ni mezclar.
--
-- Diseño:
--   - bank_statements.moneda: moneda de la cuenta (ARS | USD | EUR).
--     El ingest la detecta del PDF/CSV (ej. "Caja de ahorro U$S 12345/6").
--   - bank_movements.moneda: moneda del movimiento. Hereda del extracto pero
--     se puede sobrescribir (raro; ej. comisión en pesos en cuenta USD).
--   - bank_movements.monto: SIEMPRE en la moneda del movimiento. No se convierte.
--   - bank_movements.tipo_cambio_referencia: TC del día (BCRA) — SOLO INFO,
--     no se usa para sumar movimientos.
--   - bank_movements.tipo_cambio_referencia_fuente: 'bcra' | 'manual' | null.
--
-- Compatibilidad:
--   - Los movs/extractos existentes quedan con moneda='ARS' → nada cambia.
--   - Los KPIs (Ingresos/Egresos/Saldo) DEBEN filtrar/agrupar por moneda,
--     porque el `monto` ya no es homogéneo (puede ser USD o ARS).

alter table public.bank_statements
  add column if not exists moneda text default 'ARS' not null;

alter table public.bank_movements
  add column if not exists moneda text default 'ARS' not null,
  add column if not exists tipo_cambio_referencia numeric(18,4),
  add column if not exists tipo_cambio_referencia_fuente text;  -- 'bcra' | 'manual' | null

-- Índice para filtrar rápido movimientos por moneda
create index if not exists bank_movements_moneda_idx
  on public.bank_movements(company_id, moneda);

-- ---------------------------------------------------------------------------
-- Cache de tipos de cambio del BCRA (informativo)
-- ---------------------------------------------------------------------------
create table if not exists public.tc_cache (
  fecha        date not null,
  moneda       text not null,          -- 'USD' | 'EUR'
  tc_comprador numeric(18,4),
  tc_vendedor  numeric(18,4),
  fuente       text not null default 'bcra',  -- 'bcra' | 'manual'
  fetched_at   timestamptz not null default now(),
  primary key (fecha, moneda)
);

create index if not exists tc_cache_moneda_fecha_idx on public.tc_cache(moneda, fecha desc);

alter table public.tc_cache enable row level security;

drop policy if exists tc_cache_read_all on public.tc_cache;
create policy tc_cache_read_all on public.tc_cache
  for select using (auth.uid() is not null);

drop policy if exists tc_cache_write_admin on public.tc_cache;
create policy tc_cache_write_admin on public.tc_cache
  for insert with check (auth.uid() is not null);

drop policy if exists tc_cache_update_admin on public.tc_cache;
create policy tc_cache_update_admin on public.tc_cache
  for update using (auth.uid() is not null);
