import { NextResponse, type NextRequest } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { categorizeDocument, type DocCategorization } from "@/lib/ai/extract";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * POST /api/documents/bulk-upload
 * Form-data: múltiples "file" + opcional "dryRun" (true para solo clasificar sin guardar)
 *
 * Por cada archivo:
 *   1) Lo clasifica con Claude (categoría, nombre, fechas, organismo, vinculado_a).
 *   2) Si NO es dryRun → sube a Storage y crea company_documents.
 *   3) Si es dryRun → solo devuelve la clasificación (para mostrar preview antes de confirmar).
 *
 * Pensado para: "arrastro 10 PDFs de golpe y se archivan solos".
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles").select("company_id, active_company_id, role").eq("id", user.id).maybeSingle();
  const companyId = ((profile as any)?.active_company_id ?? profile?.company_id) as string | undefined;
  if (!companyId) return NextResponse.json({ error: "Sin empresa activa" }, { status: 400 });
  if (profile?.role !== "admin") return NextResponse.json({ error: "Solo el admin puede cargar documentos" }, { status: 403 });

  const form = await req.formData();
  const files = form.getAll("file").filter((f): f is File => f instanceof File && f.size > 0);
  const dryRun = String(form.get("dryRun") ?? "false").toLowerCase() === "true";

  if (!files.length) return NextResponse.json({ error: "Subí al menos un documento." }, { status: 400 });
  if (files.length > 15) return NextResponse.json({ error: "Máximo 15 documentos por tanda." }, { status: 400 });

  // Paralelizamos la clasificación (cada Claude tarda 3-8s; en paralelo total queda 8-15s).
  type Item = {
    fileName: string;
    size: number;
    ok: boolean;
    error?: string;
    classification?: DocCategorization;
    doc?: any;     // registro insertado
    storage_path?: string;
  };

  const items = await Promise.all(files.map(async (file): Promise<Item> => {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const base64 = Buffer.from(bytes).toString("base64");
      const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
      const classification = await categorizeDocument(
        isPdf
          ? { type: "pdf", base64 }
          : { type: "image", mediaType: (file.type || "image/png") as any, base64 }
      );
      return { fileName: file.name, size: file.size, ok: true, classification };
    } catch (e: any) {
      return { fileName: file.name, size: file.size, ok: false, error: e.message || "Error al clasificar" };
    }
  }));

  if (dryRun) {
    return NextResponse.json({ ok: true, items, dryRun: true });
  }

  // Fase 2: subir + insertar los que fueron clasificados
  for (const it of items) {
    if (!it.ok || !it.classification) continue;
    const file = files.find(f => f.name === it.fileName)!;
    const c = it.classification;
    try {
      const ext = file.name.split(".").pop() ?? "bin";
      const storage_path = `${companyId}/${c.categoria}/${crypto.randomUUID()}.${ext}`;
      const bytes = new Uint8Array(await file.arrayBuffer());
      const up = await admin.storage.from("company-documents").upload(storage_path, bytes, {
        contentType: file.type || "application/octet-stream"
      });
      if (up.error) { it.ok = false; it.error = "Storage: " + up.error.message; continue; }

      const { data: doc, error: insErr } = await admin
        .from("company_documents")
        .insert({
          company_id: companyId,
          categoria: c.categoria,
          nombre: c.nombre_sugerido?.slice(0, 180) || file.name,
          descripcion: c.descripcion,
          numero: c.numero,
          organismo: c.organismo,
          fecha_emision: c.fecha_emision || null,
          fecha_vencimiento: c.fecha_vencimiento || null,
          vinculado_a: c.vinculado_a,
          storage_path,
          mime_type: file.type || null,
          tamano_bytes: file.size,
          created_by: user.id
        })
        .select()
        .single();
      if (insErr) { it.ok = false; it.error = "DB: " + insErr.message; continue; }
      it.doc = doc;
      it.storage_path = storage_path;
    } catch (e: any) {
      it.ok = false;
      it.error = "Error inesperado: " + (e.message || "desconocido");
    }
  }

  const created = items.filter(i => i.ok && i.doc).map(i => i.doc);
  return NextResponse.json({
    ok: true,
    items,
    created,
    summary: {
      total: files.length,
      exitosos: created.length,
      fallidos: items.length - created.length
    }
  });
}
