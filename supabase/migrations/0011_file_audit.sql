-- ============================================================================
-- 0011 · Auditoría de archivos originales para contadores
-- ============================================================================
--
-- Objetivo:
--   Que el contador pueda auditar los archivos originales (PDF/Excel/CSV) que
--   la IA usó para generar el libro de IVA, marcarlos como revisados y dejar
--   notas por archivo.
--
-- Cambios:
--   1. invoices.original_filename → nombre real con el que se subió el archivo.
--      Los archivos actuales se guardan como UUID en Storage, esto preserva el
--      nombre humano ("Ventas Marzo 2026.xlsx", "Factura A0001-00234.pdf").
--   2. Tabla file_reviews: un registro por (company_id, storage_path), con
--      quién revisó, cuándo y una nota libre. Un mismo archivo puede tener 200
--      facturas asociadas; queremos revisarlo UNA vez, no 200.

alter table public.invoices
  add column if not exists original_filename text;

create table if not exists public.file_reviews (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  storage_path text not null,
  reviewed_by  uuid not null references auth.users(id) on delete restrict,
  reviewed_at  timestamptz not null default now(),
  note         text,
  status       text not null default 'ok', -- 'ok' | 'con_observacion' | 'con_error'
  unique (company_id, storage_path)
);

create index if not exists file_reviews_company_idx on public.file_reviews(company_id);
create index if not exists file_reviews_storage_idx on public.file_reviews(storage_path);

alter table public.file_reviews enable row level security;

-- Miembros de la empresa pueden leer las revisiones
drop policy if exists file_reviews_select on public.file_reviews;
create policy file_reviews_select on public.file_reviews
  for select using (
    exists (
      select 1 from public.company_members cm
      where cm.company_id = file_reviews.company_id
        and cm.user_id = auth.uid()
    )
  );

-- Miembros pueden insertar/actualizar/borrar revisiones (contadores del equipo)
drop policy if exists file_reviews_insert on public.file_reviews;
create policy file_reviews_insert on public.file_reviews
  for insert with check (
    exists (
      select 1 from public.company_members cm
      where cm.company_id = file_reviews.company_id
        and cm.user_id = auth.uid()
    )
  );

drop policy if exists file_reviews_update on public.file_reviews;
create policy file_reviews_update on public.file_reviews
  for update using (
    exists (
      select 1 from public.company_members cm
      where cm.company_id = file_reviews.company_id
        and cm.user_id = auth.uid()
    )
  );

drop policy if exists file_reviews_delete on public.file_reviews;
create policy file_reviews_delete on public.file_reviews
  for delete using (
    exists (
      select 1 from public.company_members cm
      where cm.company_id = file_reviews.company_id
        and cm.user_id = auth.uid()
    )
  );
