import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ProfileScreen } from "@/components/screens/client/profile-screen";

export default async function ClientProfilePage() {
  const session = (await getSession())!; // proxy.ts guarantees CLIENT
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    include: { client: true },
  });

  return (
    <ProfileScreen
      nameAr={user?.name ?? ""}
      nameEn={user?.nameEn ?? null}
      companyName={user?.companyName ?? null}
      email={user?.email ?? ""}
      phone={user?.phone ?? null}
      createdAt={user?.createdAt.toISOString() ?? new Date().toISOString()}
      organizationType={user?.client?.organizationType ?? null}
      sector={user?.client?.sector ?? null}
      location={user?.client?.location ?? null}
    />
  );
}
