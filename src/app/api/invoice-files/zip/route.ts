import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getActiveCompany } from "@/lib/supabase/active";
import JSZip from "jszip";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * POST /api/invoice-files/zip
 * Body: { paths: string[] }
 * Descarga múltiples archivos originales como un ZIP.
 * Todos los paths deben pertenecer a la empresa activa (empiezan por companyId/).
 */
export async function POST(req: NextRequest) {
  const { user, companyId } = await getActiveCompany();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!companyId) return NextResponse.json({ error: "Sin empresa activa" }, { status: 400 });

  const { paths } = await req.json();
  if (!Array.isArray(paths) || paths.length === 0) {
    return NextResponse.json({ error: "Sin archivos para descargar" }, { status: 400 });
  }
  if (paths.length > 200) {
    return NextResponse.json({ error: "Máximo 200 archivos por ZIP" }, { status: 400 });
  }
  // Validar que todos pertenezcan a la empresa
  for (const p of paths) {
    if (typeof p !== "string" || !p.startsWith(`${companyId}/`)) {
      return NextResponse.json({ error: "Acceso denegado a un archivo" }, { status: 403 });
    }
  }

  const admin = createAdminClient();

  // Traer nombres originales para renombrar dentro del ZIP
  const { data: invoices } = await admin
    .from("invoices")
    .select("storage_path, original_filename")
    .eq("company_id", companyId)
    .in("storage_path", paths);

  const nameByPath = new Map<string, string>();
  for (const inv of invoices ?? []) {
    if (inv.original_filename && !nameByPath.has(inv.storage_path)) {
      nameByPath.set(inv.storage_path, inv.original_filename);
    }
  }

  const zip = new JSZip();
  const usedNames = new Set<string>();
  const errors: string[] = [];

  for (const p of paths) {
    try {
      const { data, error } = await admin.storage.from("invoices").download(p);
      if (error || !data) { errors.push(p); continue; }
      const arr = new Uint8Array(await data.arrayBuffer());
      let name = nameByPath.get(p) || p.split("/").pop() || "archivo";
      // Sanitizar y desduplicar nombres
      name = name.replace(/[/\\?%*:|"<>]/g, "_");
      let final = name;
      let i = 1;
      while (usedNames.has(final)) {
        const dot = name.lastIndexOf(".");
        const base = dot > 0 ? name.slice(0, dot) : name;
        const ext = dot > 0 ? name.slice(dot) : "";
        final = `${base} (${i})${ext}`;
        i++;
      }
      usedNames.add(final);
      zip.file(final, arr);
    } catch { errors.push(p); }
  }

  const buf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });

  const filename = `archivos-originales-${new Date().toISOString().slice(0, 10)}.zip`;
  return new NextResponse(buf, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "X-Files-Failed": String(errors.length)
    }
  });
}
