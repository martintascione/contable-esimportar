-- ============================================================================
-- 0014 · Fixes de 0013: CHECK constraints en moneda + RLS más estricta
-- ============================================================================
--
-- Correcciones al esquema multi-moneda:
--   1. CHECK constraint que valida que `moneda` sea 'ARS' | 'USD' | 'EUR' | 'OTRA'
--      en bank_statements y bank_movements.
--   2. CHECK constraint que valida `moneda` en tc_cache.
--   3. Todas estas restricciones son idempotentes (DROP IF EXISTS + ADD).

-- ---------------------------------------------------------------------------
-- CHECKs en bank_statements
-- ---------------------------------------------------------------------------
alter table public.bank_statements
  drop constraint if exists bank_statements_moneda_check;

alter table public.bank_statements
  add constraint bank_statements_moneda_check
  check (moneda in ('ARS', 'USD', 'EUR', 'OTRA'));

-- ---------------------------------------------------------------------------
-- CHECKs en bank_movements
-- ---------------------------------------------------------------------------
alter table public.bank_movements
  drop constraint if exists bank_movements_moneda_check;

alter table public.bank_movements
  add constraint bank_movements_moneda_check
  check (moneda in ('ARS', 'USD', 'EUR', 'OTRA'));

alter table public.bank_movements
  drop constraint if exists bank_movements_tc_fuente_check;

alter table public.bank_movements
  add constraint bank_movements_tc_fuente_check
  check (
    tipo_cambio_referencia_fuente is null
    or tipo_cambio_referencia_fuente in ('bcra', 'manual')
  );

-- Consistencia: si moneda = 'ARS' → tipo_cambio_referencia debería ser null
-- (no se aplica CHECK porque puede haber transiciones temporales, pero
-- los endpoints ya lo respetan)

-- ---------------------------------------------------------------------------
-- CHECKs en tc_cache
-- ---------------------------------------------------------------------------
alter table public.tc_cache
  drop constraint if exists tc_cache_moneda_check;

alter table public.tc_cache
  add constraint tc_cache_moneda_check
  check (moneda in ('USD', 'EUR'));

alter table public.tc_cache
  drop constraint if exists tc_cache_fuente_check;

alter table public.tc_cache
  add constraint tc_cache_fuente_check
  check (fuente in ('bcra', 'manual'));

-- ---------------------------------------------------------------------------
-- RLS más estricta en tc_cache: sólo el service_role (usado por los endpoints)
-- puede escribir. La escritura desde el cliente autenticado queda bloqueada.
-- Los endpoints server-side usan createAdminClient que bypassea RLS con service_role.
-- ---------------------------------------------------------------------------
drop policy if exists tc_cache_write_admin on public.tc_cache;
drop policy if exists tc_cache_update_admin on public.tc_cache;

-- Sólo select público-autenticado (lo mantenemos)
-- Sin políticas de INSERT/UPDATE → sólo service_role puede escribir
