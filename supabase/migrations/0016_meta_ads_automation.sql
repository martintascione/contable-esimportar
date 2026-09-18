-- =====================================================================
-- 0016 · Meta Ads · Automatización (Etapas 2 y 3)
--   * Resúmenes diarios de lo que hizo la automatización
--   * Campos extra en ad_actions / ad_projects
-- Cómo aplicar: pegar en Supabase Studio → SQL Editor → Run.
-- =====================================================================

alter table public.ad_actions
  add column if not exists executed_by text,               -- 'user' | 'auto'
  add column if not exists rule_type  text,                -- copia del tipo de regla que la generó
  add column if not exists expires_at timestamptz;         -- una propuesta vieja deja de tener sentido

alter table public.ad_projects
  add column if not exists min_daily_budget numeric(14,2), -- piso por conjunto (moneda de la cuenta)
  add column if not exists max_daily_budget numeric(14,2), -- techo por conjunto
  add column if not exists notify_email    text;           -- resumen diario (opcional)

create table if not exists public.ad_daily_summaries (
  id          uuid primary key default uuid_generate_v4(),
  project_id  uuid not null references public.ad_projects(id) on delete cascade,
  date        date not null,
  content     jsonb not null,           -- { spend, results, cpa, roas, executed: [...], proposed: [...], alerts: n }
  text        text,                     -- versión legible del resumen
  emailed_at  timestamptz,
  created_at  timestamptz default now(),
  unique (project_id, date)
);
create index if not exists ad_daily_summaries_project_idx on public.ad_daily_summaries(project_id, date desc);
alter table public.ad_daily_summaries enable row level security;
drop policy if exists "ad_daily_summaries_owner" on public.ad_daily_summaries;
create policy "ad_daily_summaries_owner" on public.ad_daily_summaries for select
  using (public.is_my_ad_project(project_id));
