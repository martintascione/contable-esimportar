-- =====================================================================
-- 0008 · Contabilidad — Plan de cuentas, Libro Diario, Mayor
-- =====================================================================

-- Tipo de cuenta contable (los 5 grandes grupos del PCGA argentino)
do $$ begin
  create type account_type as enum ('activo', 'pasivo', 'patrimonio_neto', 'ingreso', 'egreso');
exception when duplicate_object then null; end $$;

do $$ begin
  create type entry_status as enum ('borrador', 'asentado', 'anulado');
exception when duplicate_object then null; end $$;

do $$ begin
  create type entry_source as enum ('manual', 'invoice', 'bank_movement', 'opening', 'closing');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- Plan de cuentas
-- ---------------------------------------------------------------------
create table if not exists public.accounts (
  id           uuid primary key default uuid_generate_v4(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  code         text not null,                          -- ej "1.1.1.01"
  name         text not null,                          -- ej "Banco Macro CC"
  type         account_type not null,
  parent_id    uuid references public.accounts(id) on delete set null,
  is_imputable boolean not null default true,          -- false para nodos agrupadores
  description  text,
  active       boolean not null default true,
  created_at   timestamptz default now(),
  unique (company_id, code)
);

create index if not exists accounts_company_idx on public.accounts(company_id);
create index if not exists accounts_parent_idx  on public.accounts(parent_id);
create index if not exists accounts_type_idx    on public.accounts(type);

-- ---------------------------------------------------------------------
-- Libro Diario — encabezado del asiento
-- ---------------------------------------------------------------------
create table if not exists public.journal_entries (
  id           uuid primary key default uuid_generate_v4(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  numero       integer not null,                       -- correlativo por empresa
  fecha        date not null,
  concepto     text not null,
  source       entry_source not null default 'manual',
  source_id    uuid,                                   -- id de la factura/movimiento si aplica
  total_debe   numeric(18,2) not null default 0,
  total_haber  numeric(18,2) not null default 0,
  status       entry_status not null default 'asentado',
  observaciones text,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now(),
  unique (company_id, numero)
);

create index if not exists journal_entries_company_idx on public.journal_entries(company_id);
create index if not exists journal_entries_fecha_idx   on public.journal_entries(company_id, fecha);
create index if not exists journal_entries_source_idx  on public.journal_entries(source, source_id);

-- ---------------------------------------------------------------------
-- Líneas del asiento (al menos 2 por entry, debe = haber)
-- ---------------------------------------------------------------------
create table if not exists public.journal_entry_lines (
  id          uuid primary key default uuid_generate_v4(),
  entry_id    uuid not null references public.journal_entries(id) on delete cascade,
  account_id  uuid not null references public.accounts(id) on delete restrict,
  descripcion text,
  debe        numeric(18,2) not null default 0 check (debe  >= 0),
  haber       numeric(18,2) not null default 0 check (haber >= 0),
  ord         integer not null default 0,             -- orden visual en el asiento
  created_at  timestamptz default now(),
  check (debe = 0 or haber = 0)                        -- una línea es solo debe O solo haber
);

create index if not exists jel_entry_idx   on public.journal_entry_lines(entry_id);
create index if not exists jel_account_idx on public.journal_entry_lines(account_id);

-- ---------------------------------------------------------------------
-- Función para recalcular totales del asiento al insertar/actualizar líneas
-- ---------------------------------------------------------------------
create or replace function public.recalc_entry_totals()
returns trigger
language plpgsql
as $$
declare
  v_entry uuid;
  v_debe numeric(18,2);
  v_haber numeric(18,2);
begin
  v_entry := coalesce(new.entry_id, old.entry_id);
  select coalesce(sum(debe), 0), coalesce(sum(haber), 0)
    into v_debe, v_haber
    from public.journal_entry_lines
    where entry_id = v_entry;
  update public.journal_entries
    set total_debe = v_debe,
        total_haber = v_haber,
        updated_at = now()
    where id = v_entry;
  return null;
end $$;

drop trigger if exists trg_recalc_entry_totals on public.journal_entry_lines;
create trigger trg_recalc_entry_totals
  after insert or update or delete on public.journal_entry_lines
  for each row execute function public.recalc_entry_totals();

-- ---------------------------------------------------------------------
-- Auto-numerar asientos por empresa
-- ---------------------------------------------------------------------
create or replace function public.assign_entry_number()
returns trigger
language plpgsql
as $$
begin
  if new.numero is null or new.numero = 0 then
    select coalesce(max(numero), 0) + 1
      into new.numero
      from public.journal_entries
      where company_id = new.company_id;
  end if;
  return new;
end $$;

drop trigger if exists trg_assign_entry_number on public.journal_entries;
create trigger trg_assign_entry_number
  before insert on public.journal_entries
  for each row execute function public.assign_entry_number();

-- ---------------------------------------------------------------------
-- RLS — solo miembros de la empresa pueden ver/editar
-- ---------------------------------------------------------------------
alter table public.accounts             enable row level security;
alter table public.journal_entries      enable row level security;
alter table public.journal_entry_lines  enable row level security;

drop policy if exists "accounts_member_select" on public.accounts;
create policy "accounts_member_select" on public.accounts for select
  using (
    exists (select 1 from public.company_members cm
            where cm.company_id = accounts.company_id and cm.user_id = auth.uid())
  );

drop policy if exists "accounts_admin_manage" on public.accounts;
create policy "accounts_admin_manage" on public.accounts for all
  using (
    exists (select 1 from public.company_members cm
            where cm.company_id = accounts.company_id
              and cm.user_id = auth.uid()
              and cm.role = 'admin')
  )
  with check (
    exists (select 1 from public.company_members cm
            where cm.company_id = accounts.company_id
              and cm.user_id = auth.uid()
              and cm.role = 'admin')
  );

drop policy if exists "entries_member_select" on public.journal_entries;
create policy "entries_member_select" on public.journal_entries for select
  using (
    exists (select 1 from public.company_members cm
            where cm.company_id = journal_entries.company_id and cm.user_id = auth.uid())
  );

drop policy if exists "entries_admin_manage" on public.journal_entries;
create policy "entries_admin_manage" on public.journal_entries for all
  using (
    exists (select 1 from public.company_members cm
            where cm.company_id = journal_entries.company_id
              and cm.user_id = auth.uid()
              and cm.role = 'admin')
  )
  with check (
    exists (select 1 from public.company_members cm
            where cm.company_id = journal_entries.company_id
              and cm.user_id = auth.uid()
              and cm.role = 'admin')
  );

drop policy if exists "lines_member_select" on public.journal_entry_lines;
create policy "lines_member_select" on public.journal_entry_lines for select
  using (
    exists (
      select 1 from public.journal_entries je
      join public.company_members cm on cm.company_id = je.company_id
      where je.id = journal_entry_lines.entry_id and cm.user_id = auth.uid()
    )
  );

drop policy if exists "lines_admin_manage" on public.journal_entry_lines;
create policy "lines_admin_manage" on public.journal_entry_lines for all
  using (
    exists (
      select 1 from public.journal_entries je
      join public.company_members cm on cm.company_id = je.company_id
      where je.id = journal_entry_lines.entry_id
        and cm.user_id = auth.uid()
        and cm.role = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.journal_entries je
      join public.company_members cm on cm.company_id = je.company_id
      where je.id = journal_entry_lines.entry_id
        and cm.user_id = auth.uid()
        and cm.role = 'admin'
    )
  );
