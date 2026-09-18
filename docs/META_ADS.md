# Meta Ads — Etapas 1, 2 y 3

Sección nueva del panel (`/ads`, entrada "Meta Ads" en la barra lateral) para administrar y, más adelante, automatizar campañas de Meta Ads de todas las cuentas del Meta Business. Uso personal: app Business en modo desarrollo con la Marketing API, sin App Review.

## Qué hace hoy

- **Conexión OAuth** con Meta desde el botón "Conectar Meta Ads". El backend canjea el `code` por un token de larga duración (~60 días) y lo guarda cifrado (AES-256-GCM) en `meta_connections`. El token nunca llega al navegador.
- **Proyectos**: uno por cuenta publicitaria (`ad_projects`). Al crearlo se elige la cuenta de la lista que devuelve Meta, moneda, objetivo (CPA o ROAS), qué cuenta como "resultado" y pixel. La primera sincronización trae 30 días.
- **Sincronización horaria** (`vercel.json` → `GET /api/meta/sync` cada hora) de campañas, conjuntos y anuncios + insights diarios (gasto, impresiones, alcance, clics, CPM, CTR, CPC, frecuencia, resultados, costo por resultado, compras, valor y ROAS). Después de la primera vez se re-sincronizan los últimos 7 días porque Meta reatribuye conversiones hacia atrás.
- **Dashboard por proyecto**: KPIs con comparación contra el período anterior, gráfico diario gasto/resultados, alertas, y tabla por campañas / conjuntos / anuncios con presupuesto, estado y fase de aprendizaje. Períodos de 7, 14 y 30 días.
- **Vista "Todos"**: tarjetas y tabla comparativa de todos los proyectos lado a lado.
- **Alertas** (se recalculan en cada sync, se pueden descartar): gasto sin resultados (3 días), CPA por encima del objetivo (+30% en 7 días, o ROAS por debajo del 70% del objetivo), anuncio ganador (≥5 resultados y CPA ≤80% del objetivo o ROAS ≥120%), fatiga de creativo (frecuencia >3 o caída de CTR >30% con suba de costo >30% vs. semana anterior).
- **Ventas reales (opcional)**: cada proyecto tiene un endpoint `POST /api/meta/sales/webhook?project=<id>&token=<token>` para recibir ventas desde otra base (p. ej. AIRISFIT). Se guardan en `ad_sales`; el cálculo de ROAS real sobre esa tabla queda para la Etapa 2.
- **Configuración → APIs y secrets**: carga de `META_APP_ID`, `META_APP_SECRET`, `ANTHROPIC_API_KEY`, `CRON_SECRET`, etc. desde la UI. Se guardan cifrados en `app_secrets`. Si la misma clave existe como variable de entorno, la variable tiene prioridad.

## Puesta en marcha

1. **Migración**: pegar `supabase/migrations/0015_meta_ads.sql` en Supabase → SQL Editor → Run.
2. **Clave de cifrado** (recomendado): en Vercel y `.env.local`, `APP_ENCRYPTION_KEY=$(openssl rand -hex 32)`. Sin esta variable se usa una clave derivada de la service role; funciona, pero si rotás la service role se pierden los secrets guardados.
3. **App de Meta** (developers.facebook.com → Mis apps → Crear app → tipo *Business*): agregar el producto *Marketing API*. En *Configuración → Básica* copiar App ID y App Secret. En *Inicio de sesión con Facebook → Configuración*, agregar como URI de redirección válidas:
   - `https://contable.esimportar.com/api/meta/oauth/callback`
   - `http://localhost:3000/api/meta/oauth/callback`
   La app puede quedar en modo desarrollo: solo funciona para los usuarios con rol en la app (vos), que es exactamente lo que se necesita.
4. En el panel, **Configuración → APIs y secrets**: cargar `META_APP_ID` y `META_APP_SECRET`.
5. **Cron**: definir `CRON_SECRET` como variable de entorno en Vercel (Vercel lo envía como `Authorization: Bearer` en cada ejecución del cron). El plan Hobby de Vercel solo permite crons diarios; para el horario hace falta plan Pro o disparar `GET /api/meta/sync?secret=<CRON_SECRET>` desde un cron externo (cron-job.org, n8n, etc.). El botón "Sincronizar" del panel funciona siempre.
6. Ir a **Meta Ads → Conectar Meta Ads**, aceptar los permisos (`ads_management`, `ads_read`, `business_management`, `read_insights`) y crear un proyecto por cuenta.

## Estructura

```
src/lib/crypto.ts                 cifrado AES-256-GCM + máscara
src/lib/secrets.ts                catálogo de APIs/secrets, getSecret (env > base)
src/lib/meta/api.ts               cliente Graph API: OAuth, cuentas, estructura, insights, mutaciones
src/lib/meta/connection.ts        conexión por usuario (token cifrado)
src/lib/meta/insights.ts          normalización de insights + agregados
src/lib/meta/alerts.ts            reglas de alerta Etapa 1
src/lib/meta/sync.ts              sincronización por proyecto / todos
src/lib/meta/rules.ts             motor de reglas → acciones propuestas
src/lib/meta/actions.ts           ejecución contra Meta, aprobación, resumen diario
src/components/modules/AdsAutomation.tsx
src/lib/meta/http.ts              helpers (usuario, URL pública)
src/app/api/meta/oauth/{start,callback}
src/app/api/meta/{accounts,projects,sync,alerts,disconnect}
src/app/api/meta/sales/webhook
src/app/api/secrets
src/app/(app)/ads/page.tsx        carga server-side
src/components/modules/AdsClient.tsx
src/components/modules/SecretsCard.tsx
src/components/ui/AdsChart.tsx
supabase/migrations/0015_meta_ads.sql
vercel.json                       cron horario
```

Tablas: `app_secrets`, `meta_connections`, `ad_projects`, `ad_campaigns`, `ad_adsets`, `ad_ads`, `ad_insights_daily`, `ad_sales`, `ad_alerts`, `ad_rules`, `ad_actions`, `ad_sync_runs`. Todas con RLS; los datos solo son visibles para `auth.uid()` dueño del proyecto (`is_my_ad_project()`); `app_secrets` y el token de Meta solo se leen con service role desde el servidor.

## Etapas 2 y 3 — Automatización

Cada proyecto tiene un modo de automatización (selector arriba del dashboard): **Apagada** (solo alertas), **Con aprobación** (propone acciones y las ejecuta en Meta solo cuando las aprobás) y **Automática** (las reglas marcadas como automáticas se ejecutan solas; las demás siguen pidiendo aprobación). Todo queda registrado en `ad_actions` con quién lo ejecutó (`user` / `auto`), el resultado de Meta y el motivo.

Reglas por proyecto (`ad_rules`, se crean por defecto al activar la automatización y se editan desde la tarjeta "Reglas"):

| Regla | Qué hace | Umbrales por defecto |
|---|---|---|
| Pausar anuncios que no funcionan | Pausa un anuncio activo | 3 días con gasto ≥ 2× el CPA objetivo sin resultados, o 7 días con ≥3 resultados y CPA ≥ 2× el objetivo. Espera 3 días entre acciones. |
| Bajar presupuesto | −15 % en el conjunto (o en la campaña si es CBO) | 7 días, ≥3 resultados, CPA ≥ 1,3× objetivo. No toca conjuntos en aprendizaje. Espera 3 días. |
| Escalar ganadores | +20 % en el conjunto (o campaña CBO) | 7 días, ≥5 resultados, CPA ≤ 0,8× objetivo. No toca conjuntos en aprendizaje. Espera 3 días. |
| Reactivar (apagada por defecto) | Reactiva un anuncio que la automatización pausó | ≥14 días pausado y el conjunto rindiendo dentro del objetivo. |

Con objetivo ROAS las mismas reglas se evalúan sobre ROAS (peor = ROAS por debajo del objetivo). Sin objetivo cargado se usa el promedio de la cuenta de los últimos 7 días como referencia.

Guardrails: piso y techo de presupuesto diario por conjunto (Ajustes del proyecto); una sola acción por entidad por evaluación (prioridad pausar > bajar > subir > reactivar); cooldown por entidad; las propuestas sin decidir vencen a las 48 h; nunca se toca un conjunto en fase de aprendizaje si la regla lo respeta; los cambios de presupuesto van en pasos del 5–30 %.

Flujo: cada sincronización (horaria o manual) recalcula alertas y evalúa reglas → crea acciones `proposed` (o `approved` + ejecuta si es automática). En la bandeja "Acciones" se aprueban/rechazan una por una o todas juntas; "Evaluar ahora" corre las reglas sin esperar al sync. La ejecución usa `POST /{id}` de la Graph API con `status` o `daily_budget` (en unidades menores de la moneda) y actualiza el espejo local al instante.

Resumen diario: en la primera sincronización después de las 8:00 (zona horaria de la cuenta) se genera `ad_daily_summaries` con gasto, resultados, CPA/ROAS del día anterior, acciones ejecutadas, pendientes y fallidas. Si hay `RESEND_API_KEY` (Configuración → APIs y secrets) se envía por email al `notify_email` del proyecto o al email de tu usuario; `RESEND_FROM` opcional para usar tu dominio. También se puede generar/enviar a mano desde la tarjeta "Resumen diario".

Migración: `supabase/migrations/0016_meta_ads_automation.sql` (después de la 0015).

Endpoints nuevos: `POST /api/meta/actions` (aprobar, rechazar, aprobar todas, evaluar ahora), `GET/PUT /api/meta/rules`, `POST /api/meta/summary`.

Recomendación de uso: arrancar en "Con aprobación" 2–3 semanas para ver qué propone y ajustar umbrales; después pasar a "Automática" activando primero solo "Pausar anuncios que no funcionan" como automática y dejando los cambios de presupuesto con aprobación.

## Próximo

- ROAS real con `ad_sales` (ventas recibidas por webhook) como fuente alternativa para las reglas cuando `sales_source = webhook`.
- Reglas a nivel creativo (rotación automática de anuncios nuevos cuando hay fatiga).
