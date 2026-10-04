import type { Metadata } from "next";
import { ForBrandsScreen } from "@/components/talaqee-site/for-brands";
export const metadata: Metadata = { alternates: { canonical: "/classic/for-brands" } };
export default function ForBrandsPage() { return <ForBrandsScreen />; }
