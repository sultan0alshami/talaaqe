import { AuthScreen } from "@/components/infame/auth-screen";
export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return <AuthScreen mode="verify" token={typeof token === "string" ? token : undefined} />;
}
