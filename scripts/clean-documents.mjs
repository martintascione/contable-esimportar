/**
 * Limpia TODOS los documentos de la sección "Documentación" del proyecto Supabase.
 *
 * Uso:
 *   node scripts/clean-documents.mjs              # solo la empresa activa del primer usuario
 *   node scripts/clean-documents.mjs --all        # TODAS las empresas
 *   node scripts/clean-documents.mjs --company <uuid>   # una empresa específica
 *
 * Borra:
 *   - storage/company-documents/<company_id>/...   (PDFs, imágenes)
 *   - filas en tabla company_documents
 *
 * NO TOCA: facturas, movimientos bancarios, datos de la empresa, perfiles, integraciones.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline/promises";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const envPath = path.join(__dirname, "..", ".env.local");

if (!fs.existsSync(envPath)) {
  console.error("❌ No encuentro .env.local en " + envPath);
  process.exit(1);
}
const envRaw = fs.readFileSync(envPath, "utf8");
const env = Object.fromEntries(
  envRaw.split("\n").map(l => l.trim()).filter(l => l && !l.startsWith("#") && l.includes("="))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1)]; })
);

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("❌ Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local");
  process.exit(1);
}

const args = process.argv.slice(2);
const all = args.includes("--all");
const cIdx = args.indexOf("--company");
const targetCompany = cIdx >= 0 ? args[cIdx + 1] : null;

const H = {
  "apikey": key,
  "Authorization": `Bearer ${key}`,
  "Content-Type": "application/json",
  "Prefer": "return=representation"
};

async function sb(p, init = {}) {
  const res = await fetch(url + p, { ...init, headers: { ...H, ...(init.headers ?? {}) } });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${typeof data === "string" ? data : JSON.stringify(data)}`);
  return data;
}

async function storageList(bucket, prefix) {
  const res = await fetch(`${url}/storage/v1/object/list/${bucket}`, {
    method: "POST", headers: H,
    body: JSON.stringify({ prefix, limit: 1000, sortBy: { column: "name", order: "asc" } })
  });
  if (!res.ok) throw new Error(`Storage list ${bucket}: HTTP ${res.status}`);
  return res.json();
}

async function storageRemove(bucket, paths) {
  if (!paths.length) return;
  const res = await fetch(`${url}/storage/v1/object/${bucket}`, {
    method: "DELETE", headers: H, body: JSON.stringify({ prefixes: paths })
  });
  if (!res.ok) {
    const t = await res.text();
    console.warn(`  ⚠ Storage delete falló: ${res.status} ${t.slice(0, 200)}`);
  }
}

async function listAllFilesRecursive(bucket, prefix = "") {
  const out = [];
  const stack = [prefix];
  while (stack.length) {
    const p = stack.pop();
    const items = await storageList(bucket, p);
    for (const it of items) {
      const full = p ? `${p}/${it.name}` : it.name;
      if (it.id == null) stack.push(full);   // carpeta
      else out.push(full);                   // archivo
    }
  }
  return out;
}

async function run() {
  console.log("🧹 Contable IA — limpieza de documentación de empresa");
  console.log("     URL:", url);

  let companies = [];
  if (all) {
    companies = await sb(`/rest/v1/companies?select=id,razon_social,cuit`);
    console.log(`\n   Modo: TODAS las empresas (${companies.length})`);
  } else if (targetCompany) {
    companies = await sb(`/rest/v1/companies?select=id,razon_social,cuit&id=eq.${targetCompany}`);
    if (!companies.length) { console.error("❌ Empresa no encontrada"); process.exit(1); }
    console.log(`\n   Modo: empresa única → ${companies[0].razon_social}`);
  } else {
    const profiles = await sb(`/rest/v1/profiles?select=id,email,active_company_id,company_id&limit=5`);
    const p = profiles.find(x => x.active_company_id || x.company_id);
    if (!p) { console.error("❌ No encuentro profile con empresa activa"); process.exit(1); }
    const cid = p.active_company_id ?? p.company_id;
    companies = await sb(`/rest/v1/companies?select=id,razon_social,cuit&id=eq.${cid}`);
    console.log(`\n   Modo: empresa activa del primer usuario → ${companies[0].razon_social} (${p.email})`);
  }

  let totalDocs = 0;
  for (const c of companies) {
    const h = await fetch(`${url}/rest/v1/company_documents?company_id=eq.${c.id}&select=id`, {
      headers: { ...H, "Prefer": "count=exact" }
    });
    const cnt = Number(h.headers.get("content-range")?.split("/")[1] ?? 0);
    totalDocs += cnt;
    console.log(`     • ${c.razon_social} (CUIT ${c.cuit}): ${cnt} documentos`);
  }

  if (totalDocs === 0) { console.log("\n✓ Nada para borrar.\n"); return; }

  console.log(`\n⚠  Se van a borrar ${totalDocs} documentos + sus archivos del bucket "company-documents".`);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ans = (await rl.question("\n   Escribí BORRAR para confirmar: ")).trim();
  rl.close();
  if (ans !== "BORRAR") { console.log("   Cancelado."); return; }

  for (const c of companies) {
    console.log(`\n→ ${c.razon_social}`);

    try {
      const files = await listAllFilesRecursive("company-documents", c.id);
      console.log(`  Archivos en storage: ${files.length}`);
      if (files.length) await storageRemove("company-documents", files);
    } catch (e) {
      console.warn("  ⚠ Storage:", e.message);
    }

    await sb(`/rest/v1/company_documents?company_id=eq.${c.id}`, { method: "DELETE" });
    console.log(`  ✓ Documentos borrados.`);
  }

  console.log("\n✓ Listo. Recargá /documents.\n");
}

run().catch(e => { console.error("\n❌", e.message); process.exit(1); });
