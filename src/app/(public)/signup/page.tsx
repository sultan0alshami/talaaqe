import { SignupScreen } from "@/components/screens/public/signup";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string | string[] }>;
}) {
  const { role } = await searchParams;
  return <SignupScreen initialRole={typeof role === "string" ? role : undefined} />;
}
