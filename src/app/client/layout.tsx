import { redirect } from "next/navigation";
import { requirePageSession } from "@/lib/auth";
export default async function ClientLayout() {
  await requirePageSession("BRAND");
  redirect("/brand");
}
