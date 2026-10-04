import { requirePageSession } from "@/lib/auth";
import { SettingsScreen } from "@/components/screens/settings-screen";

export default async function BrandSettingsPage() {
  await requirePageSession("BRAND");
  return <SettingsScreen />;
}
