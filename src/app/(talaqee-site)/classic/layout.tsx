import type { Metadata } from "next";
import { ClassicShell } from "@/components/talaqee-site/shell";

export const metadata: Metadata = {
  title: "إنفيم | Infame",
  robots: { index: false, follow: false },
};

export default function ClassicLayout({ children }: { children: React.ReactNode }) {
  return <ClassicShell>{children}</ClassicShell>;
}
