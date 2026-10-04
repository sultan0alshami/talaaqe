import type { Metadata } from "next";
import { AuthScreen } from "@/components/infame/auth-screen";

export const metadata: Metadata = {
  title: "تسجيل الدخول | Infame",
  alternates: { canonical: "/classic/login" },
};

export default async function ClassicLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const { next } = await searchParams;
  return <AuthScreen mode="login" websiteBase="/classic" next={typeof next === "string" ? next : undefined} />;
}
