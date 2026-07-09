import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { CATEGORIES, GRUPO_LABEL, GRUPO_SUBTITLE, categoryByKey } from "@/lib/docCategories";
import { BRAND, Logo } from "@/components/ui/Brand";
import { PublicFichaClient } from "./PublicFichaClient";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const admin = createAdminClient();
  const { data: c } = await admin
    .from("companies")
    .select("razon_social, cuit")
    .eq("public_slug", slug)
    .eq("public_enabled", true)
    .maybeSingle();
  if (!c) return { title: `Ficha fiscal — ${BRAND.company}` };
  return {
    title: `${c.razon_social} · Ficha fiscal`,
    description: `Ficha fiscal pública de ${c.razon_social} · CUIT ${c.cuit} · generada por ${BRAND.fullName}`,
    robots: { index: false, follow: false }
  };
}

export default async function PublicFichaPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const admin = createAdminClient();

  const { data: company } = await admin
    .from("companies")
    .select("*")
    .eq("public_slug", slug)
    .eq("public_enabled", true)
    .maybeSingle();

  if (!company) notFound();

  // Documentos agrupados, solo de grupos públicos (societario, fiscal, contable)
  const { data: docsRaw } = await admin
    .from("company_documents")
    .select("id, categoria, nombre, descripcion, numero, organismo, fecha_emision, fecha_vencimiento, vinculado_a, storage_path")
    .eq("company_id", company.id)
    .order("fecha_emision", { ascending: false });

  const docs = (docsRaw ?? []).filter(d => {
    const g = categoryByKey(d.categoria as any).grupo;
    return g === "societario" || g === "fiscal" || g === "contable" || g === "personal";
  });

  return (
    <PublicFichaClient
      company={company as any}
      docs={docs as any}
      slug={slug}
    />
  );
}
