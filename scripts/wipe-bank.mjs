#!/usr/bin/env node
/**
 * wipe-bank.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * Borra COMPLETAMENTE toda la data bancaria de la BD:
 *   - Todos los movimientos (bank_movements)
 *   - Todos los extractos (bank_statements)
 *   - Todas las revisiones de extractos (file_reviews donde entity_type='bank_statement')
 *   - Todos los archivos PDF/CSV originales del bucket "bank-statements"
 *   - Opcionalmente: cache del BCRA (tc_cache)
 *
 * ⚠ AFECTA A TODAS LAS EMPRESAS DE LA BD.
 *
 * Uso:
 *   node scripts/wipe-bank.mjs           # dry-run: muestra qué borraría
 *   node scripts/wipe-bank.mjs --confirm # ejecuta el borrado real
 *   node scripts/wipe-bank.mjs --confirm --tc-cache  # incluye tc_cache
 *
 * Requiere variables de entorno:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Cargalas desde .env.local con: node --env-file=.env.local scripts/wipe-bank.mjs --confirm
 */

import { createClient } from "@supabase/supabase-js";

const CONFIRM = process.argv.includes("--confirm");
const WIPE_TC_CACHE = process.argv.includes("--tc-cache");
const BUCKET = "bank-statements";

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("❌ Faltan variables de entorno SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY.");
  console.error("   Corré con: node --env-file=.env.local scripts/wipe-bank.mjs [--confirm]");
  process.exit(1);
}

const supa = createClient(url, key, { auth: { persistSession: false } });

function log(...args) { console.log(...args); }
function warn(...args) { console.warn("⚠", ...args); }
function err(...args) { console.error("❌", ...args); }

async function countTable(name, filter = null) {
  let q = supa.from(name).select("*", { count: "exact", head: true });
  if (filter) q = filter(q);
  const { count, error } = await q;
  if (error) throw new Error(`count ${name}: ${error.message}`);
  return count ?? 0;
}

async function listAllFilesRecursive(prefix = "") {
  const out = [];
  const { data, error } = await supa.storage.from(BUCKET).list(prefix, {
    limit: 1000,
    sortBy: { column: "name", order: "asc" }
  });
  if (error) throw new Error(`list ${BUCKET}/${prefix}: ${error.message}`);
  for (const item of data ?? []) {
    if (item.id === null) {
      // Es una "carpeta" — recursión
      const subPrefix = prefix ? `${prefix}/${item.name}` : item.name;
      const sub = await listAllFilesRecursive(subPrefix);
      out.push(...sub);
    } else {
      out.push(prefix ? `${prefix}/${item.name}` : item.name);
    }
  }
  return out;
}

async function main() {
  log("═══════════════════════════════════════════════════════════");
  log("  WIPE BANK — Borra TODA la data bancaria de la BD");
  log("═══════════════════════════════════════════════════════════");
  log(`Modo: ${CONFIRM ? "🔥 EJECUCIÓN REAL" : "🔍 DRY-RUN (no borra nada)"}`);
  log(`TC cache: ${WIPE_TC_CACHE ? "sí (se vacía)" : "no (se preserva)"}`);
  log("");

  // 1. Contar registros de BD
  log("📊 Contando registros...");
  const cMovs = await countTable("bank_movements");
  const cStmts = await countTable("bank_statements");
  const cRevs = await countTable("file_reviews", q => q.eq("entity_type", "bank_statement"));
  const cTc = WIPE_TC_CACHE ? await countTable("tc_cache") : 0;

  log(`   bank_movements:                 ${cMovs}`);
  log(`   bank_statements:                ${cStmts}`);
  log(`   file_reviews (bank_statement):  ${cRevs}`);
  if (WIPE_TC_CACHE) log(`   tc_cache:                       ${cTc}`);

  // 2. Listar archivos del bucket
  log("");
  log("📁 Listando archivos del bucket bank-statements...");
  let files = [];
  try {
    files = await listAllFilesRecursive();
    log(`   ${files.length} archivo(s) encontrados en el bucket`);
  } catch (e) {
    warn(`No se pudo listar el bucket: ${e.message}`);
  }

  // 3. Confirmación
  log("");
  if (!CONFIRM) {
    log("💡 Esto es un dry-run — no se borra nada.");
    log("   Para ejecutar de verdad, agregá el flag --confirm:");
    log("   node --env-file=.env.local scripts/wipe-bank.mjs --confirm" + (WIPE_TC_CACHE ? " --tc-cache" : ""));
    return;
  }

  log("🔥 Ejecutando borrado real...");
  log("");

  // 4. Borrar file_reviews primero (por si hay FK)
  {
    log("→ Borrando file_reviews (bank_statement)...");
    const { error } = await supa
      .from("file_reviews")
      .delete()
      .eq("entity_type", "bank_statement");
    if (error) err("file_reviews:", error.message);
    else log(`   ✓ borrados`);
  }

  // 5. Borrar bank_movements
  {
    log("→ Borrando bank_movements...");
    // El .neq("id", "00000000-0000-0000-0000-000000000000") es un truco para forzar
    // un WHERE en el DELETE (supabase-js requiere un filter en delete/update).
    const { error } = await supa
      .from("bank_movements")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");
    if (error) err("bank_movements:", error.message);
    else log(`   ✓ borrados`);
  }

  // 6. Borrar bank_statements
  {
    log("→ Borrando bank_statements...");
    const { error } = await supa
      .from("bank_statements")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");
    if (error) err("bank_statements:", error.message);
    else log(`   ✓ borrados`);
  }

  // 7. Borrar tc_cache si se pidió
  if (WIPE_TC_CACHE) {
    log("→ Vaciando tc_cache...");
    const { error } = await supa
      .from("tc_cache")
      .delete()
      .neq("fecha", "1900-01-01");
    if (error) err("tc_cache:", error.message);
    else log(`   ✓ vaciado`);
  }

  // 8. Borrar archivos del bucket
  if (files.length > 0) {
    log(`→ Borrando ${files.length} archivo(s) del bucket bank-statements...`);
    // Supabase permite borrar hasta 1000 paths por request
    const CHUNK = 500;
    let totalDeleted = 0;
    for (let i = 0; i < files.length; i += CHUNK) {
      const batch = files.slice(i, i + CHUNK);
      const { error } = await supa.storage.from(BUCKET).remove(batch);
      if (error) {
        err(`   error en batch ${i / CHUNK + 1}:`, error.message);
      } else {
        totalDeleted += batch.length;
      }
    }
    log(`   ✓ ${totalDeleted} archivo(s) borrado(s)`);
  }

  log("");
  log("✅ Listo. La sección de extractos bancarios quedó vacía.");
  log("   Podés subir extractos nuevos desde el panel.");
}

main().catch(e => {
  err("Fatal:", e.message);
  process.exit(1);
});
