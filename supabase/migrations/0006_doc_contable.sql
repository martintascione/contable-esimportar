-- =====================================================================
-- 0006 · Ampliar enum doc_category con documentos del contador
-- Permite archivar DDJJ mensuales, Libro IVA Digital, papeles de trabajo,
-- informes de auditoría, estados financieros, etc.
-- =====================================================================

-- PostgreSQL requiere ADD VALUE individual y fuera de transacción para enums.
-- Si ya existen, los alter ignoran silenciosamente con IF NOT EXISTS.

alter type doc_category add value if not exists 'libro_iva_digital';
alter type doc_category add value if not exists 'libro_iva_ventas';
alter type doc_category add value if not exists 'libro_iva_compras';
alter type doc_category add value if not exists 'ddjj_bienes_personales';
alter type doc_category add value if not exists 'ddjj_iibb';
alter type doc_category add value if not exists 'ddjj_iibb_cm';
alter type doc_category add value if not exists 'ddjj_monotributo';
alter type doc_category add value if not exists 'ddjj_sicore';
alter type doc_category add value if not exists 'ddjj_sicoss';
alter type doc_category add value if not exists 'ddjj_f931';
alter type doc_category add value if not exists 'estados_financieros';
alter type doc_category add value if not exists 'papel_trabajo';
alter type doc_category add value if not exists 'informe_auditoria';
alter type doc_category add value if not exists 'acta_asamblea_aprobacion_balance';
alter type doc_category add value if not exists 'memoria';
alter type doc_category add value if not exists 'anexo_balance';
alter type doc_category add value if not exists 'conciliacion_bancaria_contable';
alter type doc_category add value if not exists 'planilla_rrhh';
alter type doc_category add value if not exists 'recibo_sueldo';
alter type doc_category add value if not exists 'vep_pago';
alter type doc_category add value if not exists 'cert_retencion_recibido';
