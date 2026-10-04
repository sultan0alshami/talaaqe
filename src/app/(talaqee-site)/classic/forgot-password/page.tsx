import type { Metadata } from "next";
import { AuthScreen } from "@/components/infame/auth-screen";

export const metadata: Metadata = {
  title: "استعادة كلمة المرور | Infame",
  alternates: { canonical: "/classic/forgot-password" },
};

export default function ClassicForgotPasswordPage() {
  return <AuthScreen mode="forgot" websiteBase="/classic" />;
}
