-- =====================================================================
-- 0007 · Ficha fiscal pública
-- Permite compartir un "mini-perfil" de la empresa vía URL con slug único.
-- =====================================================================

alter table public.companies
  add column if not exists public_slug    text,
  add column if not exists public_enabled boolean default false,
  add column if not exists public_published_at timestamptz;

create unique index if not exists companies_public_slug_unique
  on public.companies(public_slug) where public_slug is not null;

-- Policy: permitir lectura pública (anon) cuando public_enabled = true.
-- No repite filas con RLS, pero otorga visibilidad por slug.
drop policy if exists "companies_public_read" on public.companies;
create policy "companies_public_read" on public.companies
  for select
  using (public_enabled = true and public_slug is not null);

-- La tabla company_documents también necesita policy pública condicional:
-- solo leer documentos de empresas con public_enabled = true
drop policy if exists "documents_public_read" on public.company_documents;
create policy "documents_public_read" on public.company_documents
  for select
  using (
    exists (
      select 1 from public.companies c
      where c.id = company_documents.company_id
        and c.public_enabled = true
        and c.public_slug is not null
    )
  );
