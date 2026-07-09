-- =====================================================================
-- 0009 · AI cache
-- Si el usuario sube el mismo archivo dos veces (mismo hash sha256),
-- evitamos llamar de nuevo a la API y reusamos la respuesta.
-- =====================================================================

create table if not exists public.ai_cache (
  hash         text primary key,
  kind         text not null,                -- 'invoice' | 'invoice_list' | 'bank' | 'doc_categorize' | 'company_data'
  model        text not null,                -- el modelo usado (ej "claude-haiku-4-5-20251001")
  response     jsonb not null,
  bytes_size   integer,
  created_at   timestamptz default now()
);

create index if not exists ai_cache_kind_idx on public.ai_cache(kind);
create index if not exists ai_cache_created_idx on public.ai_cache(created_at);

-- Sin RLS — el cache es global por hash. El acceso se mediará desde el server con service_role.
