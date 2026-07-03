import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { UsersScreen } from "@/components/screens/admin/users-screen";

// Admin users — mirrors GET /api/admin/users.
export default async function AdminUsersPage() {
  const session = await getSession();
  const users = await prisma.user.findMany({ orderBy: { createdAt: "desc" } });

  return (
    <UsersScreen
      selfId={session?.userId ?? ""}
      users={users.map((u) => ({
        id: u.id,
        nameAr: u.name,
        nameEn: u.nameEn ?? u.name,
        email: u.email,
        role: u.role,
        active: u.active,
        joined: u.createdAt.toISOString(),
      }))}
    />
  );
}
