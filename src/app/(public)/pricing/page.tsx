import type { Metadata } from "next";
import { InformationPage } from "@/components/infame/information-page";

export const metadata: Metadata = { title: "الأسعار · Pricing" };

export default function PricingPage() { return <InformationPage kind="pricing" />; }
