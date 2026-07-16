-- ============================================================================
-- 0012 · Auditoría de resúmenes bancarios (mismo sistema que facturas)
-- ============================================================================
--
-- Objetivo:
--   Aplicar el mismo esquema de auditoría por archivo que ya tenemos para
--   invoices, pero a bank_statements (los extractos PDF/CSV bancarios).
--
-- Cambios:
--   1. bank_statements.original_filename → nombre real del archivo subido.
--   2. file_reviews.entity_type → 'invoice' | 'bank_statement'
--        - Los registros existentes (todos de facturas) reciben default 'invoice'.
--        - El unique(company_id, storage_path) se recrea incluyendo entity_type
--          para permitir que un mismo path se revise en ambos contextos si hiciera falta.
--          (En la práctica no ocurre — los buckets son distintos —, pero cubre bien.)

alter table public.bank_statements
  add column if not exists original_filename text;

alter table public.file_reviews
  add column if not exists entity_type text not null default 'invoice';

-- Reemplazar el unique constraint viejo por uno que contemple entity_type
alter table public.file_reviews
  drop constraint if exists file_reviews_company_id_storage_path_key;

alter table public.file_reviews
  add constraint file_reviews_company_entity_path_key
  unique (company_id, entity_type, storage_path);

-- Índice adicional para queries filtradas por tipo de entidad
create index if not exists file_reviews_entity_idx
  on public.file_reviews(company_id, entity_type);
