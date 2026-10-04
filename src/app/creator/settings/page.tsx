import { requirePageSession } from "@/lib/auth";
import { SettingsScreen } from "@/components/screens/settings-screen";

export default async function CreatorSettingsPage() {
  await requirePageSession("CREATOR");
  return <SettingsScreen />;
}
