import type { Metadata } from "next";
import { AuthScreen } from "@/components/infame/auth-screen";

export const metadata: Metadata = {
  title: "انضم إلى إنفيم | Infame",
  alternates: { canonical: "/classic/signup" },
};

export default async function ClassicSignupPage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string | string[] }>;
}) {
  const { role } = await searchParams;
  const initialRole = typeof role === "string" && (role === "brand" || role === "company") ? "brand" : "creator";
  return <AuthScreen key={initialRole} mode="signup" websiteBase="/classic" initialRole={initialRole} />;
}
