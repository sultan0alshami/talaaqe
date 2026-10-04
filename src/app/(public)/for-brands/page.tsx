import type { Metadata } from "next";
import { InformationPage } from "@/components/infame/information-page";

export const metadata: Metadata = { title: "للعلامات التجارية · For brands" };

export default function ForBrandsPage() { return <InformationPage kind="brands" />; }
