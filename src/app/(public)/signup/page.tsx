import { AuthScreen } from "@/components/infame/auth-screen";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string | string[] }>;
}) {
  const { role } = await searchParams;
  return <AuthScreen mode="signup" initialRole={typeof role === "string" ? role : undefined} />;
}
