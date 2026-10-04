import type { Metadata } from "next";
import { AboutScreen } from "@/components/talaqee-site/about";
export const metadata: Metadata = { alternates: { canonical: "/classic/about" } };
export default function AboutPage() { return <AboutScreen />; }
