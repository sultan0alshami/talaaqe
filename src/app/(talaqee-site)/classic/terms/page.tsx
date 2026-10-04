import type { Metadata } from "next";
import { LegalNotice } from "@/components/talaqee-site/legal-notice";
export const metadata: Metadata = { alternates: { canonical: "/classic/terms" } };
export default function TermsPage() { return <LegalNotice kind="terms" />; }
