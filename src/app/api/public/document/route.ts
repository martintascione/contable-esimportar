import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * GET /api/public/document?slug=<slug>&id=<docId>
 *
 * Devuelve una signed URL de 2 minutos para un documento, pero SOLO si
 * el documento pertenece a una empresa con public_enabled = true Y
 * el slug provisto coincide con el de esa empresa.
 *
 * Es público (no requiere login) y es lo que usan los botones "Ver" de la ficha pública.
 */
export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get("slug");
  const id = req.nextUrl.searchParams.get("id");
  if (!slug || !id) return NextResponse.json({ error: "Faltan parámetros" }, { status: 400 });

  const admin = createAdminClient();

  // 1) Validar que la empresa esté publicada con ese slug
  const { data: company } = await admin
    .from("companies").select("id").eq("public_slug", slug).eq("public_enabled", true).maybeSingle();
  if (!company) return NextResponse.json({ error: "Ficha no encontrada o despublicada" }, { status: 404 });

  // 2) Validar que el documento sea de esa empresa
  const { data: doc } = await admin
    .from("company_documents")
    .select("id, company_id, storage_path, nombre")
    .eq("id", id)
    .eq("company_id", company.id)
    .maybeSingle();
  if (!doc) return NextResponse.json({ error: "Documento no encontrado" }, { status: 404 });
  if (!doc.storage_path) return NextResponse.json({ error: "Sin archivo asociado" }, { status: 404 });

  // 3) Generar signed URL temporal (120 segundos)
  const { data: signed, error } = await admin.storage
    .from("company-documents")
    .createSignedUrl(doc.storage_path, 120);
  if (error || !signed?.signedUrl) {
    return NextResponse.json({ error: error?.message ?? "Error al firmar URL" }, { status: 500 });
  }

  return NextResponse.json({ url: signed.signedUrl, nombre: doc.nombre });
}
