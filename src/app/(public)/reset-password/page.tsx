import { AuthScreen } from "@/components/infame/auth-screen";
export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return <AuthScreen mode="reset" token={typeof token === "string" ? token : undefined} />;
}
