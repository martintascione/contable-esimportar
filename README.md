# Contable IA

Plataforma contable moderna para PyMEs argentinas con extracción de facturas y extractos bancarios por IA. Stack: **Next.js 14 + Supabase + Claude (Anthropic)**.

---

## Módulos

- **Dashboard IVA** — KPIs, carga de facturas por drag & drop, libro mensual y resumen anual con gráfico débito/crédito.
- **Conciliación bancaria** — Carga de extractos PDF, detección automática de impuestos Ley 25.413, SIRCREB y comisiones; vinculación con facturas.
- **Documentación de la empresa** — Estatutos, DNI de socios, firma digital, inscripciones ARCA/DPPJ/IIBB, habilitaciones, poderes y más. Con alertas de vencimiento.
- **Configuración** — Datos fiscales, integraciones (AFIP, Mercado Pago, Resend, WhatsApp, n8n, GDrive) y gestión de usuarios.

---

## 1. Crear proyecto Supabase

1. Entrá a [app.supabase.com](https://app.supabase.com) → **New project**.
2. Anotá del panel **Settings → API**:
   - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public key` → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role key` → `SUPABASE_SERVICE_ROLE_KEY` (¡secreto!)
3. En **SQL Editor**, pegá el contenido de `supabase/migrations/0001_initial_schema.sql` y ejecutalo. Crea todas las tablas, enums, RLS y buckets de Storage.
4. En **Authentication → Providers**, dejá habilitado **Email / Password**.

## 2. Obtener API key de Anthropic (Claude)

1. [console.anthropic.com](https://console.anthropic.com) → **API keys** → **Create key**.
2. Copiala como `ANTHROPIC_API_KEY`.
3. Modelo recomendado: `claude-sonnet-4-5` (el default). Podés probar `claude-opus-4-6` para máxima precisión en comprobantes difíciles.

## 3. Instalar y correr local

```bash
cp .env.local.example .env.local
# completar las variables con tus valores reales

npm install
npm run dev
```

Abrí [http://localhost:3000](http://localhost:3000). Registrate como **Administrador** y creá tu empresa; eso asocia tu usuario al `company_id` correcto gracias al trigger `handle_new_user` + el paso de registro.

## 4. Deploy en Vercel

```bash
vercel
# en Vercel → Settings → Environment Variables
# replicá todas las claves de .env.local
```

Tamaño máximo de upload: ajustado a 20 MB en `next.config.js` (suficiente para resúmenes bancarios extensos). Si necesitás más, movelo a Supabase Storage resumable uploads.

---

## Estructura

```
contable-ia/
├── src/
│   ├── app/
│   │   ├── (auth)/{login,register}/        # páginas públicas
│   │   ├── (app)/{dashboard,bank,documents,settings}/  # panel autenticado
│   │   ├── api/ingest/{invoice,bank}/      # pipeline IA
│   │   ├── api/documents/upload/           # carga de documentación
│   │   └── auth/callback/                  # callback OAuth/email
│   ├── components/
│   │   ├── ui/                             # Sidebar, Topbar, Kpi, Badge, AnnualChart, Icons
│   │   └── modules/                        # *Client.tsx (interactivos)
│   └── lib/
│       ├── supabase/                       # client, server, middleware, types
│       ├── ai/                             # prompts + extract (Claude)
│       ├── docCategories.ts                # catálogo de documentos empresa
│       └── format.ts
├── supabase/migrations/0001_initial_schema.sql
├── middleware.ts                           # protección de rutas
├── tailwind.config.ts
└── .env.local.example
```

## Pipeline IA (facturas)

1. Usuario suelta PDF/imagen en el dropzone.
2. `POST /api/ingest/invoice` sube el archivo a `storage/invoices/<company_id>/<YYYY-MM>/<uuid>.<ext>`.
3. Llama a Claude con el prompt AFIP específico (`src/lib/ai/prompts.ts`) y parsea el JSON.
4. Compara `cuit_emisor` vs. el CUIT de la empresa: si coinciden → venta; si no → compra.
5. Inserta en `invoices` con `status = aprobada` si `confidence >= 0.85`, si no `revision`.
6. El dashboard se refresca (`router.refresh()`).

## Pipeline IA (extractos bancarios)

1. `POST /api/ingest/bank` sube PDF a `storage/bank-statements/<company_id>/…`.
2. Claude detecta encabezado (banco, cuenta, CBU, período) + cada movimiento con categoría.
3. Crea `bank_statements` y todos los `bank_movements`.
4. Para cada movimiento intenta match con facturas (±2% de monto, ±10 días) → `estado: conciliado`. Si es impuesto/comisión detectado, queda como `impuesto`. Resto queda `pendiente` para vincular manualmente.

## Seguridad

- RLS activo en todas las tablas — cada usuario solo ve datos de su `company_id`.
- Storage policies aisladas por `company_id` (convención de path: `<company_id>/...`).
- Operaciones destructivas (delete de documentos, invitar usuarios) restringidas a `role = admin`.
- La `service_role key` nunca se expone al cliente; solo se usa en rutas server-side cuando haga falta bypass.

## Próximos pasos sugeridos

- **Invitaciones por email** usando `supabase.auth.admin.inviteUserByEmail` en una API route protegida por admin.
- **Exportaciones** a Excel (usar `xlsx` o `exceljs`) del libro IVA y conciliación.
- **Edge Functions** para el cierre mensual automático (cron semanal/mensual).
- **WebHooks de AFIP** o scraping de Mis Comprobantes via n8n para descarga automática.
- **Alertas por WhatsApp/Resend** cuando haya documentos próximos a vencer o cierre de IVA.

Panel: https://contable.esimportar.com
