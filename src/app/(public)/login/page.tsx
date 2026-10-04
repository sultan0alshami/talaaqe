import { AuthScreen } from "@/components/infame/auth-screen";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const { next } = await searchParams;
  return <AuthScreen mode="login" next={typeof next === "string" ? next : undefined} />;
}
