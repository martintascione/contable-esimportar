-- =====================================================================
-- 0005 · Socios / accionistas / apoderados de la empresa
-- Permite identificar movimientos bancarios hacia/desde ellos y calcular
-- saldos deudor/acreedor de la cuenta particular.
-- =====================================================================

create table if not exists public.company_partners (
  id            uuid primary key default uuid_generate_v4(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  nombre        text not null,
  cuit          text,
  dni           text,
  relacion      text default 'socio',               -- 'socio', 'administrador', 'apoderado', 'director'
  porcentaje    numeric,                            -- % de participación societaria (opcional)
  observaciones text,
  created_at    timestamptz default now(),
  created_by    uuid references auth.users(id) on delete set null
);

create unique index if not exists company_partners_cuit_unique
  on public.company_partners(company_id, cuit) where cuit is not null;

create index if not exists company_partners_company_idx on public.company_partners(company_id);
create index if not exists company_partners_cuit_idx    on public.company_partners(cuit);

alter table public.company_partners enable row level security;

drop policy if exists "partners_members_select" on public.company_partners;
create policy "partners_members_select" on public.company_partners for select
  using (
    exists (
      select 1 from public.company_members cm
      where cm.company_id = company_partners.company_id
        and cm.user_id = auth.uid()
    )
  );

drop policy if exists "partners_admin_manage" on public.company_partners;
create policy "partners_admin_manage" on public.company_partners for all
  using (
    exists (
      select 1 from public.company_members cm
      where cm.company_id = company_partners.company_id
        and cm.user_id = auth.uid()
        and cm.role = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.company_members cm
      where cm.company_id = company_partners.company_id
        and cm.user_id = auth.uid()
        and cm.role = 'admin'
    )
  );
