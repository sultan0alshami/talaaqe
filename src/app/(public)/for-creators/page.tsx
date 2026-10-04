import type { Metadata } from "next";
import { InformationPage } from "@/components/infame/information-page";

export const metadata: Metadata = { title: "لصنّاع المحتوى · For creators" };

export default function ForCreatorsPage() { return <InformationPage kind="creators" />; }
