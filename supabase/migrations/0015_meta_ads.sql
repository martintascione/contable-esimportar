-- =====================================================================
-- 0015 · Meta Ads (proyectos, insights, alertas, reglas, acciones)
--        + app_secrets (APIs y secrets cargados desde Configuración)
--
-- Cómo aplicar:
--   Pegá este SQL completo en Supabase Studio → SQL Editor → Run.
--
-- Seguridad:
--   * Todas las tablas tienen RLS. Solo el usuario dueño (auth.uid()) ve
--     sus proyectos y datos derivados. app_secrets y meta_connections no
--     tienen policies de lectura: solo se acceden con service_role desde
--     el servidor. Los valores sensibles se guardan cifrados (AES-256-GCM)
--     por la app antes de llegar a la base.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0) Secrets de aplicación (Meta App ID / Secret, API keys, etc.)
-- ---------------------------------------------------------------------
create table if not exists public.app_secrets (
  key         text primary key,           -- p.ej. 'META_APP_ID', 'META_APP_SECRET'
  value_enc   text not null,              -- valor cifrado por la app (nunca en claro)
  is_secret   boolean not null default true,
  updated_by  uuid references auth.users(id) on delete set null,
  updated_at  timestamptz default now()
);
alter table public.app_secrets enable row level security;
-- Sin policies: nadie con anon/authenticated puede leer ni escribir. Solo service_role.

-- ---------------------------------------------------------------------
-- 1) Conexión OAuth con Meta (una por usuario)
-- ---------------------------------------------------------------------
create table if not exists public.meta_connections (
  id                uuid primary key default uuid_generate_v4(),
  user_id           uuid not null unique references auth.users(id) on delete cascade,
  meta_user_id      text,
  meta_user_name    text,
  access_token_enc  text not null,          -- token de larga duración, cifrado
  token_expires_at  timestamptz,
  scopes            text[],
  status            text not null default 'connected', -- connected | expired | error
  last_error        text,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);
alter table public.meta_connections enable row level security;
-- Solo metadata para el dueño (nunca el token: la app filtra columnas server-side).
drop policy if exists "meta_conn_owner_select" on public.meta_connections;
create policy "meta_conn_owner_select" on public.meta_connections for select
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- 2) Proyectos (una cuenta publicitaria = un proyecto)
-- ---------------------------------------------------------------------
create table if not exists public.ad_projects (
  id                  uuid primary key default uuid_generate_v4(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  connection_id       uuid references public.meta_connections(id) on delete set null,
  name                text not null,
  ad_account_id       text not null,          -- 'act_123456789'
  ad_account_name     text,
  business_name       text,
  pixel_id            text,
  currency            text not null default 'USD',
  timezone            text,
  goal_type           text not null default 'cpa',   -- cpa | roas
  goal_value          numeric(14,4),                 -- CPA objetivo (moneda) o ROAS objetivo (x)
  result_action_type  text,                          -- 'purchase' | 'lead' | 'complete_registration' | ... (null = auto)
  automation_mode     text not null default 'off',   -- off | manual | auto
  status              text not null default 'active',-- active | paused | archived
  sales_source        text not null default 'meta',  -- meta | webhook
  webhook_token       text,                          -- para recibir ventas reales
  last_sync_at        timestamptz,
  last_sync_error     text,
  created_at          timestamptz default now(),
  updated_at          timestamptz default now(),
  unique (user_id, ad_account_id)
);
create index if not exists ad_projects_user_idx on public.ad_projects(user_id);
alter table public.ad_projects enable row level security;
drop policy if exists "ad_projects_owner_all" on public.ad_projects;
create policy "ad_projects_owner_all" on public.ad_projects for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Helper: ¿el proyecto es mío?
create or replace function public.is_my_ad_project(p uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.ad_projects where id = p and user_id = auth.uid());
$$;

-- ---------------------------------------------------------------------
-- 3) Estructura de la cuenta (espejo de Meta)
-- ---------------------------------------------------------------------
create table if not exists public.ad_campaigns (
  id               text primary key,                 -- id de Meta
  project_id       uuid not null references public.ad_projects(id) on delete cascade,
  name             text not null,
  status           text,
  effective_status text,
  objective        text,
  daily_budget     numeric(14,2),
  lifetime_budget  numeric(14,2),
  created_time     timestamptz,
  raw              jsonb,
  updated_at       timestamptz default now()
);
create index if not exists ad_campaigns_project_idx on public.ad_campaigns(project_id);
alter table public.ad_campaigns enable row level security;
drop policy if exists "ad_campaigns_owner" on public.ad_campaigns;
create policy "ad_campaigns_owner" on public.ad_campaigns for select
  using (public.is_my_ad_project(project_id));

create table if not exists public.ad_adsets (
  id                text primary key,
  project_id        uuid not null references public.ad_projects(id) on delete cascade,
  campaign_id       text references public.ad_campaigns(id) on delete cascade,
  name              text not null,
  status            text,
  effective_status  text,
  daily_budget      numeric(14,2),
  lifetime_budget   numeric(14,2),
  optimization_goal text,
  learning_stage    text,                            -- LEARNING | SUCCESS | FAIL | null
  created_time      timestamptz,
  raw               jsonb,
  updated_at        timestamptz default now()
);
create index if not exists ad_adsets_project_idx on public.ad_adsets(project_id);
alter table public.ad_adsets enable row level security;
drop policy if exists "ad_adsets_owner" on public.ad_adsets;
create policy "ad_adsets_owner" on public.ad_adsets for select
  using (public.is_my_ad_project(project_id));

create table if not exists public.ad_ads (
  id                text primary key,
  project_id        uuid not null references public.ad_projects(id) on delete cascade,
  adset_id          text references public.ad_adsets(id) on delete cascade,
  campaign_id       text references public.ad_campaigns(id) on delete cascade,
  name              text not null,
  status            text,
  effective_status  text,
  creative_id       text,
  thumbnail_url     text,
  created_time      timestamptz,
  raw               jsonb,
  updated_at        timestamptz default now()
);
create index if not exists ad_ads_project_idx on public.ad_ads(project_id);
alter table public.ad_ads enable row level security;
drop policy if exists "ad_ads_owner" on public.ad_ads;
create policy "ad_ads_owner" on public.ad_ads for select
  using (public.is_my_ad_project(project_id));

-- ---------------------------------------------------------------------
-- 4) Métricas diarias (campaign / adset / ad)
-- ---------------------------------------------------------------------
create table if not exists public.ad_insights_daily (
  id               uuid primary key default uuid_generate_v4(),
  project_id       uuid not null references public.ad_projects(id) on delete cascade,
  level            text not null,                    -- campaign | adset | ad
  entity_id        text not null,
  date             date not null,
  spend            numeric(14,2) not null default 0,
  impressions      bigint not null default 0,
  reach            bigint not null default 0,
  clicks           bigint not null default 0,
  link_clicks      bigint not null default 0,
  frequency        numeric(10,4),
  cpm              numeric(14,4),
  ctr              numeric(10,4),
  cpc              numeric(14,4),
  results          numeric(14,2) not null default 0,
  result_type      text,
  cost_per_result  numeric(14,4),
  purchases        numeric(14,2) not null default 0,
  purchase_value   numeric(14,2) not null default 0,
  roas             numeric(10,4),
  raw              jsonb,
  updated_at       timestamptz default now(),
  unique (project_id, level, entity_id, date)
);
create index if not exists ad_insights_project_date_idx on public.ad_insights_daily(project_id, date desc);
create index if not exists ad_insights_entity_idx on public.ad_insights_daily(entity_id, date desc);
alter table public.ad_insights_daily enable row level security;
drop policy if exists "ad_insights_owner" on public.ad_insights_daily;
create policy "ad_insights_owner" on public.ad_insights_daily for select
  using (public.is_my_ad_project(project_id));

-- ---------------------------------------------------------------------
-- 5) Ventas reales (opcional por proyecto, vía webhook/API)
-- ---------------------------------------------------------------------
create table if not exists public.ad_sales (
  id           uuid primary key default uuid_generate_v4(),
  project_id   uuid not null references public.ad_projects(id) on delete cascade,
  external_id  text,
  occurred_at  timestamptz not null default now(),
  amount       numeric(14,2) not null,
  currency     text,
  source       text not null default 'webhook',
  meta         jsonb,
  created_at   timestamptz default now(),
  unique (project_id, external_id)
);
create index if not exists ad_sales_project_date_idx on public.ad_sales(project_id, occurred_at desc);
alter table public.ad_sales enable row level security;
drop policy if exists "ad_sales_owner" on public.ad_sales;
create policy "ad_sales_owner" on public.ad_sales for select
  using (public.is_my_ad_project(project_id));

-- ---------------------------------------------------------------------
-- 6) Alertas
-- ---------------------------------------------------------------------
create table if not exists public.ad_alerts (
  id           uuid primary key default uuid_generate_v4(),
  project_id   uuid not null references public.ad_projects(id) on delete cascade,
  type         text not null,       -- spend_no_results | cpa_above_goal | winner | creative_fatigue | learning_limited
  severity     text not null default 'warning',   -- info | warning | danger | success
  level        text not null,       -- campaign | adset | ad
  entity_id    text not null,
  entity_name  text,
  message      text not null,
  data         jsonb,
  status       text not null default 'open',      -- open | dismissed | resolved
  created_at   timestamptz default now(),
  resolved_at  timestamptz,
  unique (project_id, type, entity_id, status)
);
create index if not exists ad_alerts_project_idx on public.ad_alerts(project_id, status);
alter table public.ad_alerts enable row level security;
drop policy if exists "ad_alerts_owner" on public.ad_alerts;
create policy "ad_alerts_owner" on public.ad_alerts for all
  using (public.is_my_ad_project(project_id)) with check (public.is_my_ad_project(project_id));

-- ---------------------------------------------------------------------
-- 7) Reglas (Etapa 2) y acciones (auditoría)
-- ---------------------------------------------------------------------
create table if not exists public.ad_rules (
  id           uuid primary key default uuid_generate_v4(),
  project_id   uuid not null references public.ad_projects(id) on delete cascade,
  name         text not null,
  type         text not null,       -- pause_bad_ad | scale_winner | budget_up | budget_down | reactivate
  config       jsonb not null default '{}'::jsonb,
  enabled      boolean not null default true,
  mode         text not null default 'manual',      -- manual | auto
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);
create index if not exists ad_rules_project_idx on public.ad_rules(project_id);
alter table public.ad_rules enable row level security;
drop policy if exists "ad_rules_owner" on public.ad_rules;
create policy "ad_rules_owner" on public.ad_rules for all
  using (public.is_my_ad_project(project_id)) with check (public.is_my_ad_project(project_id));

create table if not exists public.ad_actions (
  id           uuid primary key default uuid_generate_v4(),
  project_id   uuid not null references public.ad_projects(id) on delete cascade,
  rule_id      uuid references public.ad_rules(id) on delete set null,
  type         text not null,       -- pause | activate | set_budget
  level        text not null,       -- campaign | adset | ad
  entity_id    text not null,
  entity_name  text,
  payload      jsonb,               -- p.ej. { "daily_budget": 12000, "from": 10000 }
  reason       text,
  status       text not null default 'proposed',    -- proposed | approved | rejected | executed | failed
  proposed_at  timestamptz default now(),
  decided_at   timestamptz,
  executed_at  timestamptz,
  result       jsonb,
  error        text
);
create index if not exists ad_actions_project_idx on public.ad_actions(project_id, status);
alter table public.ad_actions enable row level security;
drop policy if exists "ad_actions_owner" on public.ad_actions;
create policy "ad_actions_owner" on public.ad_actions for all
  using (public.is_my_ad_project(project_id)) with check (public.is_my_ad_project(project_id));

-- ---------------------------------------------------------------------
-- 8) Log de sincronizaciones
-- ---------------------------------------------------------------------
create table if not exists public.ad_sync_runs (
  id           uuid primary key default uuid_generate_v4(),
  project_id   uuid references public.ad_projects(id) on delete cascade,
  trigger      text not null default 'cron',   -- cron | manual
  started_at   timestamptz default now(),
  finished_at  timestamptz,
  ok           boolean,
  stats        jsonb,
  error        text
);
create index if not exists ad_sync_runs_project_idx on public.ad_sync_runs(project_id, started_at desc);
alter table public.ad_sync_runs enable row level security;
drop policy if exists "ad_sync_runs_owner" on public.ad_sync_runs;
create policy "ad_sync_runs_owner" on public.ad_sync_runs for select
  using (public.is_my_ad_project(project_id));
