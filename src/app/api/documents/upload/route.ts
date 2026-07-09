import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles").select("company_id, active_company_id, role").eq("id", user.id).single();
  const companyId = ((profile as any)?.active_company_id ?? profile?.company_id) as string | undefined;
  if (!companyId) return NextResponse.json({ error: "Sin empresa activa" }, { status: 400 });
  if (profile?.role !== "admin")
    return NextResponse.json({ error: "Solo el administrador puede cargar documentación" }, { status: 403 });

  const form = await req.formData();
  const file = form.get("file") as File | null;
  const categoria = String(form.get("categoria") ?? "otro");
  const nombre = String(form.get("nombre") ?? "").trim();
  const descripcion = String(form.get("descripcion") ?? "").trim() || null;
  const numero = String(form.get("numero") ?? "").trim() || null;
  const organismo = String(form.get("organismo") ?? "").trim() || null;
  const fecha_emision = String(form.get("fecha_emision") ?? "").trim() || null;
  const fecha_vencimiento = String(form.get("fecha_vencimiento") ?? "").trim() || null;
  const vinculado_a = String(form.get("vinculado_a") ?? "").trim() || null;

  if (!nombre) return NextResponse.json({ error: "Falta el nombre" }, { status: 400 });

  let storage_path: string | null = null;
  let mime_type: string | null = null;
  let tamano_bytes: number | null = null;

  if (file && file.size > 0) {
    const ext = file.name.split(".").pop() ?? "bin";
    storage_path = `${companyId}/${categoria}/${crypto.randomUUID()}.${ext}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const up = await supabase.storage.from("company-documents").upload(storage_path, bytes, {
      contentType: file.type || "application/octet-stream"
    });
    if (up.error) return NextResponse.json({ error: "Fallo al subir: " + up.error.message }, { status: 500 });
    mime_type = file.type || null;
    tamano_bytes = file.size;
  }

  const { data: doc, error } = await supabase
    .from("company_documents")
    .insert({
      company_id: companyId,
      categoria: categoria as any,
      nombre,
      descripcion,
      numero,
      organismo,
      fecha_emision,
      fecha_vencimiento,
      vinculado_a,
      storage_path,
      mime_type,
      tamano_bytes,
      created_by: user.id
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(doc);
}
