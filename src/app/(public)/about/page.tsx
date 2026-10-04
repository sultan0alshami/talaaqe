import type { Metadata } from "next";
import { InformationPage } from "@/components/infame/information-page";

export const metadata: Metadata = { title: "عن إنفيم · About" };

export default function AboutPage() {
  return <InformationPage kind="about" />;
}
