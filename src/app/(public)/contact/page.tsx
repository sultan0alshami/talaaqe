import type { Metadata } from "next";
import { InformationPage } from "@/components/infame/information-page";

export const metadata: Metadata = { title: "التواصل · Contact" };

export default function ContactPage() {
  return <InformationPage kind="contact" />;
}
