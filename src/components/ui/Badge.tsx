export type BadgeTone =
  | "venta" | "compra"
  | "conciliado" | "pendiente" | "impuesto" | "gasto_bancario"
  | "ingreso" | "egreso"
  | "success" | "warning" | "danger" | "info"
  | "default";

const map: Record<BadgeTone, { bg: string; c: string }> = {
  venta:      { bg: "var(--accent-soft)", c: "var(--accent)" },
  compra:     { bg: "#e6f6ed",            c: "#30a46c" },
  conciliado: { bg: "#e6f6ed",            c: "#30a46c" },
  pendiente:  { bg: "#fcf0dd",            c: "#b4730e" },
  impuesto:   { bg: "#efeaff",            c: "#7c5cff" },
  gasto_bancario: { bg: "#efeaff",        c: "#7c5cff" },
  ingreso:    { bg: "#e6f6ed",            c: "#30a46c" },
  egreso:     { bg: "#fdeaef",            c: "#f04f6f" },
  success:    { bg: "#e6f6ed",            c: "#30a46c" },
  warning:    { bg: "#fcf0dd",            c: "#b4730e" },
  danger:     { bg: "#fdeaef",            c: "#f04f6f" },
  info:       { bg: "var(--accent-soft)", c: "var(--accent)" },
  default:    { bg: "#ececf0",            c: "#6e6e73" },
};

export function Badge({ tone = "default", children }: { tone?: BadgeTone; children: React.ReactNode }) {
  const t = map[tone];
  return <span className="chip" style={{ background: t.bg, color: t.c }}>{children}</span>;
}
