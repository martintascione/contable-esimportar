import { NextResponse } from "next/server";
import { requireUser } from "@/lib/meta/http";
import { createAdminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/** POST /api/meta/disconnect — borra la conexión (los proyectos quedan, sin token). */
export async function POST() {
  const { user, res } = await requireUser();
  if (!user) return res!;
  const admin = createAdminClient();
  await admin.from("meta_connections").delete().eq("user_id", user.id);
  return NextResponse.json({ ok: true });
}
