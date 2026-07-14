import { SettingsScreen } from "@/components/screens/settings-screen";
import { AiSettingsScreen } from "@/components/screens/admin/ai-settings-screen";
import { getAdminAiStatus } from "@/lib/ai-providers";

// Reads DB settings + env at request time — never prerender.
export const dynamic = "force-dynamic";

export default async function AdminSettingsPage() {
  const ai = await getAdminAiStatus();
  return (
    <SettingsScreen>
      <AiSettingsScreen data={ai} />
    </SettingsScreen>
  );
}
