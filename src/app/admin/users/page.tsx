import { redirect } from "next/navigation";
import { requirePageSession } from "@/lib/auth";
import { AdminReadError, type AdminUsersDTO } from "@/lib/admin/contracts";
import { getAdminUsers, parseAdminUsersQuery } from "@/lib/admin/users";
import { UsersScreen } from "@/components/screens/admin/users-screen";

export default async function AdminUsersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requirePageSession("ADMIN");
  const query = await searchParams;
  let users: AdminUsersDTO | null = null, errorCode: string | null = null, after: string | undefined;
  try {
    after = parseAdminUsersQuery(query).after;
    users = await getAdminUsers(actor, after ? { after } : {});
  } catch (error) {
    if (!(error instanceof AdminReadError)) throw error;
    if (error.status === 401 || error.status === 403) redirect("/login");
    errorCode = error.code;
  }
  return <UsersScreen key={after ?? "first"} initialUsers={users} after={after} errorCode={errorCode} />;
}
