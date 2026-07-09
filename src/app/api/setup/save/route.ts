import { NextResponse, type NextRequest } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const runtime = "nodejs";

/**
 * POST /api/setup/save
 * Body: { supabaseUrl, anonKey, serviceRoleKey, anthropicKey, anthropicModel? }
 *
 * En desarrollo (NODE_ENV !== "production") escribe/actualiza .env.local en la raíz del proyecto.
 * En producción NUNCA toca el filesystem — devuelve un bloque .env listo para copiar y pegar en
 * Vercel o el proveedor que use el cliente.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const {
    supabaseUrl,
    anonKey,
    serviceRoleKey,
    anthropicKey,
    anthropicModel = "claude-sonnet-4-5"
  } = body;

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return NextResponse.json({ error: "Faltan datos de Supabase" }, { status: 400 });
  }

  const envText = [
    `# Panel Contable esImportar — configurado ${new Date().toISOString()}`,
    `NEXT_PUBLIC_SUPABASE_URL=${supabaseUrl}`,
    `NEXT_PUBLIC_SUPABASE_ANON_KEY=${anonKey}`,
    `SUPABASE_SERVICE_ROLE_KEY=${serviceRoleKey}`,
    `ANTHROPIC_API_KEY=${anthropicKey ?? ""}`,
    `ANTHROPIC_MODEL=${anthropicModel}`,
    `NEXT_PUBLIC_SITE_URL=${process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"}`,
    ``,
    `# Integraciones opcionales`,
    `RESEND_API_KEY=${process.env.RESEND_API_KEY ?? ""}`,
    `WHATSAPP_API_TOKEN=${process.env.WHATSAPP_API_TOKEN ?? ""}`,
    `MERCADOPAGO_ACCESS_TOKEN=${process.env.MERCADOPAGO_ACCESS_TOKEN ?? ""}`,
    ``
  ].join("\n");

  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({
      saved: false,
      envText,
      message:
        "Producción detectada: cargá estas variables en tu proveedor (Vercel → Settings → Environment Variables) y reinyectá el deploy."
    });
  }

  // Dev — escribir a .env.local
  try {
    const envPath = path.join(process.cwd(), ".env.local");
    await fs.writeFile(envPath, envText, "utf8");
    return NextResponse.json({
      saved: true,
      path: ".env.local",
      message: "Credenciales guardadas. Reiniciá `npm run dev` para aplicar."
    });
  } catch (e: any) {
    return NextResponse.json(
      { saved: false, error: "No se pudo escribir .env.local: " + e.message, envText },
      { status: 500 }
    );
  }
}
