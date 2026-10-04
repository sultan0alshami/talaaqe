import { redirect } from "next/navigation";
import { requirePageSession } from "@/lib/auth";
export default async function ProviderLayout() {
  await requirePageSession("CREATOR");
  redirect("/creator");
}
