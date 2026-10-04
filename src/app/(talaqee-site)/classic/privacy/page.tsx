import type { Metadata } from "next";
import { LegalNotice } from "@/components/talaqee-site/legal-notice";
export const metadata: Metadata = { alternates: { canonical: "/classic/privacy" } };
export default function PrivacyPage() { return <LegalNotice kind="privacy" />; }
