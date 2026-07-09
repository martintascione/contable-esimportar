-- =====================================================================
-- Contable IA — Esquema inicial
-- PostgreSQL / Supabase
--
-- Cómo aplicar:
--   supabase db push        # si usás la CLI
--   o pegar este SQL en Supabase Studio → SQL Editor → Run
-- =====================================================================

-- Extensiones
create extension if not exists "uuid-ossp";
create extension if not exists pgcrypto;

-- =====================================================================
-- Enums
-- =====================================================================
do $$ begin
  create type user_role as enum ('admin','contador');
exception when duplicate_object then null; end $$;

do $$ begin
  create type invoice_type as enum ('venta','compra');
exception when duplicate_object then null; end $$;

do $$ begin
  create type invoice_status as enum ('pendiente','aprobada','revision','rechazada');
exception when duplicate_object then null; end $$;

do $$ begin
  create type movement_type as enum ('ingreso','egreso');
exception when duplicate_object then null; end $$;

do $$ begin
  create type movement_status as enum ('conciliado','pendiente','impuesto','gasto_bancario');
exception when duplicate_object then null; end $$;

do $$ begin
  create type doc_category as enum (
    'estatuto',
    'acta_constitutiva',
    'acta_asamblea',
    'acta_directorio',
    'dni_socio',
    'firma_digital',
    'inscripcion_arca',
    'inscripcion_dppj',
    'inscripcion_iibb',
    'constancia_cuit',
    'habilitacion_municipal',
    'poder',
    'libre_deuda',
    'balance',
    'ddjj_ganancias',
    'ddjj_iva',
    'certificado_pyme',
    'contrato_alquiler',
    'otro'
  );
exception when duplicate_object then null; end $$;

-- =====================================================================
-- Companies
-- =====================================================================
create table if not exists public.companies (
  id uuid primary key default uuid_generate_v4(),
  razon_social    text not null,
  cuit            text not null unique,
  condicion_iva   text default 'Responsable Inscripto',
  iibb            text,
  actividad       text,
  direccion       text,
  owner_id        uuid references auth.users(id) on delete set null,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- =====================================================================
-- Profiles (1 fila por usuario de auth.users)
-- =====================================================================
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text unique,
  full_name   text,
  role        user_role not null default 'contador',
  company_id  uuid references public.companies(id) on delete set null,
  created_at  timestamptz default now()
);

-- Trigger: al crear un usuario en auth.users, crear perfil vacío
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)),
    coalesce((new.raw_user_meta_data->>'role')::user_role, 'contador')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- =====================================================================
-- Invoices (libro IVA Ventas / Compras)
-- =====================================================================
create table if not exists public.invoices (
  id             uuid primary key default uuid_generate_v4(),
  company_id     uuid not null references public.companies(id) on delete cascade,
  tipo           invoice_type not null,
  fecha          date not null,
  razon_social   text not null,
  cuit           text,
  comprobante    text,          -- ej: "FA 0001-00041"
  punto_venta    text,
  numero         text,
  neto_gravado   numeric(14,2) not null default 0,
  iva_21         numeric(14,2) default 0,
  iva_10_5       numeric(14,2) default 0,
  iva_27         numeric(14,2) default 0,
  iva_otros      numeric(14,2) default 0,
  iva_total      numeric(14,2) generated always as (coalesce(iva_21,0)+coalesce(iva_10_5,0)+coalesce(iva_27,0)+coalesce(iva_otros,0)) stored,
  percepciones   numeric(14,2) default 0,
  total          numeric(14,2) not null default 0,
  cae            text,
  storage_path   text,          -- path en Supabase Storage
  ai_metadata    jsonb,         -- respuesta cruda del modelo
  ai_confidence  numeric(4,3),  -- 0.000 – 1.000
  status         invoice_status not null default 'pendiente',
  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);

create index if not exists idx_invoices_company_fecha on public.invoices(company_id, fecha desc);
create index if not exists idx_invoices_company_tipo  on public.invoices(company_id, tipo);

-- =====================================================================
-- Bank statements (PDF subido) + movements (línea por línea)
-- =====================================================================
create table if not exists public.bank_statements (
  id            uuid primary key default uuid_generate_v4(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  banco         text not null,
  cuenta        text,
  cbu           text,
  periodo_desde date,
  periodo_hasta date,
  storage_path  text,
  ai_metadata   jsonb,
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz default now()
);

create table if not exists public.bank_movements (
  id           uuid primary key default uuid_generate_v4(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  statement_id uuid references public.bank_statements(id) on delete cascade,
  fecha        date not null,
  descripcion  text not null,
  tipo         movement_type not null,
  monto        numeric(14,2) not null,
  estado       movement_status not null default 'pendiente',
  invoice_id   uuid references public.invoices(id) on delete set null,
  referencia   text,
  created_at   timestamptz default now()
);

create index if not exists idx_mov_company_fecha on public.bank_movements(company_id, fecha);

-- =====================================================================
-- Documentación legal / fiscal de la empresa
-- =====================================================================
create table if not exists public.company_documents (
  id                uuid primary key default uuid_generate_v4(),
  company_id        uuid not null references public.companies(id) on delete cascade,
  categoria         doc_category not null,
  nombre            text not null,           -- "Estatuto social 2020"
  descripcion       text,
  numero            text,                    -- folio / nro expediente
  organismo         text,                    -- AFIP, DPPJ-PBA, ARBA, etc.
  fecha_emision     date,
  fecha_vencimiento date,
  vinculado_a       text,                    -- ej: socio (CUIT/DNI), inmueble, etc.
  storage_path      text,                    -- ubicación del archivo
  mime_type         text,
  tamano_bytes      bigint,
  notas             text,
  created_by        uuid references auth.users(id) on delete set null,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

create index if not exists idx_docs_company on public.company_documents(company_id);
create index if not exists idx_docs_venc on public.company_documents(fecha_vencimiento) where fecha_vencimiento is not null;

-- =====================================================================
-- Integraciones por empresa (credenciales cifradas a nivel Supabase Vault
-- en el futuro; por ahora solo metadata de conexión).
-- =====================================================================
create table if not exists public.integrations (
  id          uuid primary key default uuid_generate_v4(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  provider    text not null,                -- 'afip','mercadopago','resend','whatsapp','n8n','gdrive'
  status      text not null default 'disconnected', -- 'connected','disconnected','error'
  config      jsonb,                        -- referencias no sensibles
  connected_at timestamptz,
  created_at  timestamptz default now(),
  unique (company_id, provider)
);

-- =====================================================================
-- Helpers
-- =====================================================================
create or replace function public.current_company_id()
returns uuid
language sql
stable
as $$
  select company_id from public.profiles where id = auth.uid();
$$;

create or replace function public.current_role()
returns user_role
language sql
stable
as $$
  select role from public.profiles where id = auth.uid();
$$;

-- =====================================================================
-- Row Level Security
-- =====================================================================
alter table public.companies          enable row level security;
alter table public.profiles           enable row level security;
alter table public.invoices           enable row level security;
alter table public.bank_statements    enable row level security;
alter table public.bank_movements     enable row level security;
alter table public.company_documents  enable row level security;
alter table public.integrations       enable row level security;

-- profiles: cada usuario ve y actualiza solo su perfil; admin ve todos los de su empresa
drop policy if exists "profiles_self_select" on public.profiles;
create policy "profiles_self_select" on public.profiles for select
  using (auth.uid() = id or company_id = public.current_company_id());

drop policy if exists "profiles_self_update" on public.profiles;
create policy "profiles_self_update" on public.profiles for update
  using (auth.uid() = id);

drop policy if exists "profiles_admin_manage" on public.profiles;
create policy "profiles_admin_manage" on public.profiles for all
  using (public.current_role() = 'admin' and company_id = public.current_company_id())
  with check (public.current_role() = 'admin' and company_id = public.current_company_id());

-- companies: los miembros ven su empresa; solo admin la actualiza
drop policy if exists "companies_members_select" on public.companies;
create policy "companies_members_select" on public.companies for select
  using (id = public.current_company_id());

drop policy if exists "companies_admin_update" on public.companies;
create policy "companies_admin_update" on public.companies for update
  using (id = public.current_company_id() and public.current_role() = 'admin');

drop policy if exists "companies_owner_insert" on public.companies;
create policy "companies_owner_insert" on public.companies for insert
  with check (auth.uid() = owner_id);

-- invoices, bank_*, company_documents, integrations: aislamiento por company_id
do $$
declare t text;
begin
  for t in select unnest(array[
    'invoices','bank_statements','bank_movements','company_documents','integrations'
  ]) loop
    execute format('drop policy if exists "%1$s_company_rw" on public.%1$s', t);
    execute format('create policy "%1$s_company_rw" on public.%1$s for all
      using (company_id = public.current_company_id())
      with check (company_id = public.current_company_id())', t);
  end loop;
end $$;

-- =====================================================================
-- Storage buckets
-- =====================================================================
insert into storage.buckets (id, name, public)
values
  ('invoices','invoices',false),
  ('bank-statements','bank-statements',false),
  ('company-documents','company-documents',false)
on conflict (id) do nothing;

-- Policies de Storage: los usuarios solo ven archivos cuya ruta comience
-- con el company_id al que pertenecen (convención: <company_id>/<resto>).
drop policy if exists "storage_company_read" on storage.objects;
create policy "storage_company_read" on storage.objects for select
  using (
    bucket_id in ('invoices','bank-statements','company-documents')
    and (storage.foldername(name))[1] = public.current_company_id()::text
  );

drop policy if exists "storage_company_write" on storage.objects;
create policy "storage_company_write" on storage.objects for insert
  with check (
    bucket_id in ('invoices','bank-statements','company-documents')
    and (storage.foldername(name))[1] = public.current_company_id()::text
  );

drop policy if exists "storage_company_delete" on storage.objects;
create policy "storage_company_delete" on storage.objects for delete
  using (
    bucket_id in ('invoices','bank-statements','company-documents')
    and (storage.foldername(name))[1] = public.current_company_id()::text
    and public.current_role() = 'admin'
  );

-- =====================================================================
-- Triggers updated_at
-- =====================================================================
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;

do $$
declare t text;
begin
  for t in select unnest(array['companies','invoices','company_documents']) loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format('create trigger set_updated_at before update on public.%I
      for each row execute procedure public.set_updated_at()', t);
  end loop;
end $$;
