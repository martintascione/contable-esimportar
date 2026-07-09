import { SetupWizard } from "@/components/modules/SetupWizard";

export const dynamic = "force-dynamic";

export default function SetupPage() {
  return (
    <div className="min-h-screen bg-surface-1">
      <SetupWizard
        initial={{
          supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
          anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
          serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
          anthropicKey: process.env.ANTHROPIC_API_KEY ?? "",
          anthropicModel: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5"
        }}
      />
    </div>
  );
}
