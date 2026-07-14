import { LoginScreen } from "@/components/screens/public/login";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const { next } = await searchParams;
  return <LoginScreen next={typeof next === "string" ? next : undefined} />;
}
