import { createAdminClient } from "@/lib/supabase/server";
import { decrypt, encrypt } from "@/lib/crypto";

export type MetaConnection = {
  id: string; user_id: string; meta_user_id: string | null; meta_user_name: string | null;
  token_expires_at: string | null; scopes: string[] | null; status: string; last_error: string | null;
  created_at: string; updated_at: string;
};

/** Metadata de la conexión (sin token). */
export async function getConnection(userId: string): Promise<MetaConnection | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("meta_connections")
    .select("id, user_id, meta_user_id, meta_user_name, token_expires_at, scopes, status, last_error, created_at, updated_at")
    .eq("user_id", userId)
    .maybeSingle();
  return (data as MetaConnection) ?? null;
}

/** Token en claro (solo server-side). */
export async function getAccessToken(userId: string): Promise<{ token: string; connection: MetaConnection } | null> {
  const admin = createAdminClient();
  const { data } = await admin.from("meta_connections").select("*").eq("user_id", userId).maybeSingle();
  if (!data) return null;
  const { access_token_enc, ...rest } = data as any;
  return { token: decrypt(access_token_enc), connection: rest as MetaConnection };
}

export async function saveConnection(userId: string, p: {
  token: string; expiresAt: Date | null; metaUserId: string; metaUserName: string; scopes: string[];
}) {
  const admin = createAdminClient();
  const { data, error } = await admin.from("meta_connections").upsert({
    user_id: userId,
    meta_user_id: p.metaUserId,
    meta_user_name: p.metaUserName,
    access_token_enc: encrypt(p.token),
    token_expires_at: p.expiresAt?.toISOString() ?? null,
    scopes: p.scopes,
    status: "connected",
    last_error: null,
    updated_at: new Date().toISOString()
  }, { onConflict: "user_id" }).select("id").single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

export async function markConnectionError(userId: string, message: string, expired = false) {
  const admin = createAdminClient();
  await admin.from("meta_connections")
    .update({ status: expired ? "expired" : "error", last_error: message, updated_at: new Date().toISOString() })
    .eq("user_id", userId);
}
