import type { Metadata } from "next";
import { ContactScreen } from "@/components/talaqee-site/contact";
export const metadata: Metadata = { alternates: { canonical: "/classic/contact" } };
export default function ContactPage() { return <ContactScreen />; }
