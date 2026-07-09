-- =====================================================================
-- 0002 · Multi-empresa
-- Agrega membresías por usuario + empresa activa (switcher).
-- Retrocompatible con el esquema 0001 (copia company_id -> active_company_id).
--
-- Cómo aplicar:
--   Pegá este SQL completo en Supabase Studio → SQL Editor → Run.
-- =====================================================================

-- 1) Columna de empresa activa en profiles
alter table public.profiles
  add column if not exists active_company_id uuid references public.companies(id) on delete set null;

-- 2) Tabla de membresías (un usuario puede estar en varias empresas)
create table if not exists public.company_members (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  company_id  uuid not null references public.companies(id) on delete cascade,
  role        user_role not null default 'admin',
  created_at  timestamptz default now(),
  unique(user_id, company_id)
);

create index if not exists company_members_user_idx    on public.company_members(user_id);
create index if not exists company_members_company_idx on public.company_members(company_id);

alter table public.company_members enable row level security;

drop policy if exists "members_self_select" on public.company_members;
create policy "members_self_select" on public.company_members for select
  using (auth.uid() = user_id);

-- Los admins de una empresa pueden ver y gestionar los miembros de esa misma empresa
drop policy if exists "members_company_admin_select" on public.company_members;
create policy "members_company_admin_select" on public.company_members for select
  using (
    exists (
      select 1 from public.company_members cm
      where cm.company_id = company_members.company_id
        and cm.user_id = auth.uid()
        and cm.role = 'admin'
    )
  );

drop policy if exists "members_company_admin_manage" on public.company_members;
create policy "members_company_admin_manage" on public.company_members for all
  using (
    exists (
      select 1 from public.company_members cm
      where cm.company_id = company_members.company_id
        and cm.user_id = auth.uid()
        and cm.role = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.company_members cm
      where cm.company_id = company_members.company_id
        and cm.user_id = auth.uid()
        and cm.role = 'admin'
    )
  );

-- 3) Migrar datos viejos: cada profile con company_id pasa a company_members
insert into public.company_members (user_id, company_id, role)
select p.id, p.company_id, coalesce(p.role, 'admin')
from public.profiles p
where p.company_id is not null
on conflict (user_id, company_id) do nothing;

-- Setear empresa activa si todavía es null
update public.profiles
set active_company_id = company_id
where company_id is not null and active_company_id is null;

-- 4) Actualizar el helper: current_company_id() ahora usa active_company_id con fallback
create or replace function public.current_company_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(p.active_company_id, p.company_id)
  from public.profiles p
  where p.id = auth.uid()
$$;

-- 5) Policies de SELECT sobre companies: el usuario ve cualquier empresa donde sea miembro
drop policy if exists "companies_members_select" on public.companies;
create policy "companies_members_select" on public.companies for select
  using (
    exists (
      select 1 from public.company_members cm
      where cm.company_id = companies.id and cm.user_id = auth.uid()
    )
  );

-- Los invoices / documents / movements usan current_company_id() que ya apunta a la activa.
-- No hace falta tocar más policies.

-- =====================================================================
-- Fin migración 0002
-- =====================================================================
