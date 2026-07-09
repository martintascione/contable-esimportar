import { redirect } from "next/navigation";
import { Sidebar } from "@/components/ui/Sidebar";
import { CameraFab } from "@/components/ui/CameraFab";
import { createClient } from "@/lib/supabase/server";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();
  const profile = data as { full_name?: string | null; role?: string | null } | null;

  return (
    <div className="flex flex-col md:flex-row min-h-screen">
      <Sidebar
        user={{
          email: user.email ?? "",
          name: profile?.full_name ?? user.email ?? "Usuario",
          role: profile?.role ?? "contador"
        }}
      />
      <main className="flex-1 min-w-0">{children}</main>
      <CameraFab />
    </div>
  );
}
