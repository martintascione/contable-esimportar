import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { extractCompanyData, type CompanyDataExtraction } from "@/lib/ai/extract";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/company/extract
 * Form-data: file (uno o varios — keys "file" repetidas)
 *
 * Procesa cada documento con Claude y devuelve un merge unificado:
 *   - cada campo gana del documento con mayor confidence donde aparezca
 *   - acumula warnings y detalles por archivo
 *
 * No persiste nada — solo devuelve la extracción para que el usuario
 * la revise y confirme antes de crear la empresa.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const form = await req.formData();
  const files = form.getAll("file").filter((f): f is File => f instanceof File && f.size > 0);

  if (!files.length) {
    return NextResponse.json({ error: "Subí al menos un documento." }, { status: 400 });
  }
  if (files.length > 6) {
    return NextResponse.json({ error: "Máximo 6 documentos por vez." }, { status: 400 });
  }

  const per: { fileName: string; ok: boolean; data?: CompanyDataExtraction; error?: string }[] = [];

  for (const file of files) {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const base64 = Buffer.from(bytes).toString("base64");
      const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
      const data = await extractCompanyData(
        isPdf
          ? { type: "pdf", base64 }
          : { type: "image", mediaType: (file.type || "image/png") as any, base64 }
      );
      per.push({ fileName: file.name, ok: true, data });
    } catch (e: any) {
      per.push({ fileName: file.name, ok: false, error: e.message || "Error al procesar" });
    }
  }

  // Merge — por cada campo, el valor del doc con mayor confidence que lo tenga
  const fields: (keyof CompanyDataExtraction)[] = [
    "razon_social", "nombre_fantasia", "cuit",
    "condicion_iva", "iibb", "iibb_jurisdiccion",
    "actividad_principal", "codigo_actividad",
    "fecha_inscripcion", "fecha_inicio_actividades",
    "direccion_fiscal", "provincia", "localidad", "codigo_postal"
  ];

  const successes = per.filter(p => p.ok && p.data).sort((a, b) => (b.data!.confidence ?? 0) - (a.data!.confidence ?? 0));
  const merged: any = {};
  for (const f of fields) {
    for (const s of successes) {
      const v = (s.data as any)[f];
      if (v != null && v !== "") { merged[f] = v; break; }
    }
    if (merged[f] === undefined) merged[f] = null;
  }

  const allWarnings = successes.flatMap(s => s.data!.warnings ?? []);
  const tipos = successes.map(s => s.data!.tipo_documento_detectado).filter(Boolean);

  return NextResponse.json({
    ok: true,
    merged,
    perFile: per.map(p => ({
      fileName: p.fileName,
      ok: p.ok,
      error: p.error,
      tipo_documento: p.data?.tipo_documento_detectado,
      confidence: p.data?.confidence
    })),
    warnings: allWarnings,
    tiposDetectados: Array.from(new Set(tipos))
  });
}
