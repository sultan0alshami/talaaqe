import type { Metadata } from "next";
import { ForCreatorsScreen } from "@/components/talaqee-site/for-creators";
export const metadata: Metadata = { alternates: { canonical: "/classic/for-creators" } };
export default function ForCreatorsPage() { return <ForCreatorsScreen />; }
