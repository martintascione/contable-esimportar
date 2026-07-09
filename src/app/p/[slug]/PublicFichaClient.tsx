"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icons";
import { BRAND, Logo } from "@/components/ui/Brand";
import { GRUPO_LABEL, GRUPO_SUBTITLE, categoryByKey } from "@/lib/docCategories";
import { daysUntil } from "@/lib/format";

type Company = {
  id: string;
  razon_social: string;
  cuit: string;
  condicion_iva?: string | null;
  iibb?: string | null;
  actividad?: string | null;
  direccion?: string | null;
  public_slug: string;
  public_published_at?: string | null;
};

type Doc = {
  id: string;
  categoria: any;
  nombre: string;
  descripcion: string | null;
  numero: string | null;
  organismo: string | null;
  fecha_emision: string | null;
  fecha_vencimiento: string | null;
  vinculado_a: string | null;
  storage_path: string | null;
};

export function PublicFichaClient({ company, docs, slug }: { company: Company; docs: Doc[]; slug: string }) {
  // Separar en dos secciones:
  //   Documentación (societario + fiscal + personal)
  //   Impuestos y DDJJ (contable)
  const { documentacion, impuestos } = useMemo(() => {
    const doc: Record<string, Doc[]> = {};
    const imp: Record<string, Doc[]> = {};
    for (const d of docs) {
      const g = categoryByKey(d.categoria).grupo;
      if (g === "contable") {
        (imp[g] ??= []).push(d);
      } else {
        (doc[g] ??= []).push(d);
      }
    }
    return { documentacion: doc, impuestos: imp };
  }, [docs]);

  async function openDoc(id: string) {
    try {
      const r = await fetch(`/api/public/document?slug=${encodeURIComponent(slug)}&id=${encodeURIComponent(id)}`);
      const d = await r.json();
      if (!r.ok || !d.url) throw new Error(d.error || "Error");
      window.open(d.url, "_blank", "noopener,noreferrer");
    } catch (e: any) {
      alert("No se pudo abrir el documento: " + e.message);
    }
  }

  return (
    <div className="min-h-screen" style={{ background: "radial-gradient(1200px 600px at 50% -10%, #e8f1fd 0%, #f5f5f7 60%)" }}>
      <div className="max-w-5xl mx-auto px-6 py-10 space-y-6">

        {/* Header de la empresa */}
        <div className="card soft p-8">
          <div className="flex items-start justify-between gap-6 flex-wrap">
            <div className="min-w-0">
              <div className="text-[12px] uppercase tracking-wider text-ink-3">Ficha fiscal</div>
              <div className="sf-display text-[30px] font-bold tracking-tight mt-1 leading-tight">
                {company.razon_social}
              </div>
              <div className="flex flex-wrap gap-4 mt-3 text-[13px] text-ink-2">
                <div className="flex items-center gap-1.5">
                  <span className="text-ink-3">CUIT</span>
                  <span className="font-mono font-semibold text-ink-1">{company.cuit}</span>
                </div>
                {company.condicion_iva && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-ink-3">Condición IVA</span>
                    <span className="font-semibold text-ink-1">{company.condicion_iva}</span>
                  </div>
                )}
                {company.iibb && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-ink-3">IIBB</span>
                    <span className="font-semibold text-ink-1">{company.iibb}</span>
                  </div>
                )}
              </div>
            </div>
            <div className="shrink-0 text-right">
              <Logo size="md" subtitle="Ficha verificada"/>
            </div>
          </div>

          <div className="divider my-5"/>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 text-[13px]">
            {company.actividad && (
              <InfoBlock label="Actividad principal" value={company.actividad}/>
            )}
            {company.direccion && (
              <InfoBlock label="Domicilio fiscal" value={company.direccion}/>
            )}
          </div>

          {company.public_published_at && (
            <div className="mt-5 text-[11px] text-ink-3">
              Ficha generada el {new Date(company.public_published_at).toLocaleDateString("es-AR", {
                day: "2-digit", month: "long", year: "numeric"
              })}
            </div>
          )}
        </div>

        {/* Documentación */}
        <SectionTitle title="Documentación" subtitle="Constitución, socios, inscripciones"/>
        {Object.keys(documentacion).length === 0 ? (
          <EmptyCard mensaje="Esta empresa todavía no publicó documentación."/>
        ) : (
          Object.entries(documentacion).map(([g, list]) => (
            <DocGroupCard
              key={g}
              title={GRUPO_LABEL[g as keyof typeof GRUPO_LABEL]}
              subtitle={GRUPO_SUBTITLE[g as keyof typeof GRUPO_LABEL]}
              docs={list}
              onOpen={openDoc}
            />
          ))
        )}

        {/* Impuestos y DDJJ */}
        <SectionTitle title="Impuestos y DDJJ presentadas" subtitle="DDJJ, libros IVA, balances e informes"/>
        {Object.keys(impuestos).length === 0 ? (
          <EmptyCard mensaje="Esta empresa todavía no publicó DDJJ ni documentos impositivos."/>
        ) : (
          Object.entries(impuestos).map(([g, list]) => (
            <DocGroupCard
              key={g}
              title={GRUPO_LABEL[g as keyof typeof GRUPO_LABEL]}
              subtitle={GRUPO_SUBTITLE[g as keyof typeof GRUPO_LABEL]}
              docs={list}
              onOpen={openDoc}
            />
          ))
        )}

        {/* Footer */}
        <div className="text-center text-[11px] text-ink-3 py-6">
          Ficha fiscal generada con <a href={BRAND.logoUrl ? "/" : "/"} className="font-semibold text-ink-2 hover:text-ink-1">{BRAND.fullName}</a>
          <div className="mt-1">{BRAND.copyright}</div>
        </div>
      </div>
    </div>
  );
}

function InfoBlock({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-ink-3 mb-0.5">{label}</div>
      <div className="text-[14px] text-ink-1">{value}</div>
    </div>
  );
}

function SectionTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mt-4 mb-1">
      <div className="sf-display text-[22px] font-bold tracking-tight">{title}</div>
      {subtitle && <div className="text-[13px] text-ink-2">{subtitle}</div>}
    </div>
  );
}

function EmptyCard({ mensaje }: { mensaje: string }) {
  return <div className="card p-8 text-center text-[13px] text-ink-3">{mensaje}</div>;
}

function DocGroupCard({
  title, subtitle, docs, onOpen
}: {
  title: string; subtitle?: string;
  docs: Doc[];
  onOpen: (id: string) => void;
}) {
  if (!docs.length) return null;
  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-4 border-b border-line">
        <div className="sf-display text-[15px] font-semibold">{title}</div>
        {subtitle && <div className="text-[12px] text-ink-3">{subtitle}</div>}
      </div>
      <div className="overflow-x-auto scroll-clean">
        <table className="clean">
          <thead>
            <tr>
              <th>Documento</th>
              <th>Categoría</th>
              <th>Organismo</th>
              <th>Emisión</th>
              <th>Vencimiento</th>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {docs.map(d => {
              const cat = categoryByKey(d.categoria);
              const days = daysUntil(d.fecha_vencimiento);
              let estado: { tone: any; text: string };
              if (!d.fecha_vencimiento) estado = { tone: "info", text: "Sin vencimiento" };
              else if (days! < 0) estado = { tone: "danger", text: `Vencido hace ${Math.abs(days!)} días` };
              else if (days! <= 30) estado = { tone: "warning", text: `Vence en ${days} días` };
              else estado = { tone: "success", text: "Vigente" };
              return (
                <tr key={d.id}>
                  <td className="font-medium" title={d.nombre}>
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-brand-soft text-brand shrink-0">
                        <Icon.File/>
                      </div>
                      <div className="min-w-0 truncate" style={{ maxWidth: 300 }}>
                        <div className="truncate">{d.nombre}</div>
                        {d.numero && <div className="text-[11px] text-ink-3">N° {d.numero}{d.vinculado_a ? " · " + d.vinculado_a : ""}</div>}
                      </div>
                    </div>
                  </td>
                  <td className="text-ink-2">{cat.label}</td>
                  <td className="text-ink-2 truncate" style={{ maxWidth: 200 }}>{d.organismo ?? cat.organismoSugerido ?? "—"}</td>
                  <td className="text-ink-2">{d.fecha_emision ?? "—"}</td>
                  <td className="text-ink-2">{d.fecha_vencimiento ?? "—"}</td>
                  <td><Badge tone={estado.tone}>{estado.text}</Badge></td>
                  <td className="text-right">
                    {d.storage_path && (
                      <button className="btn btn-ghost" style={{padding:"6px 10px"}} onClick={() => onOpen(d.id)}>
                        <Icon.Download/> Ver
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
