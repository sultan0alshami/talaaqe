import { z } from "zod";
import { redirect } from "next/navigation";
import { requirePageSession } from "@/lib/auth";
import { parseBrandContextInput } from "@/lib/brand-context/contracts";
import { brandContextPageError } from "@/lib/brand-context/page-context";
import { listContextOwnerReviews } from "@/lib/brand-context/service";
import type { ContextOwnerReviewsScreenProps } from "@/lib/brand-context/ui-contract";
import { ContextOwnerReviewsScreen } from "@/components/infame/brand-context";

export default async function ContextOwnerReviewsPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requirePageSession("BRAND");
  let initialPage: ContextOwnerReviewsScreenProps["initialPage"] = null, initialError: string | null = null;
  try {
    parseBrandContextInput(z.object({}).strict(), await searchParams);
    initialPage = await listContextOwnerReviews(actor);
  } catch (error) { initialError = brandContextPageError(error); if (initialError === "UNAUTHENTICATED") redirect("/login"); }
  return <ContextOwnerReviewsScreen key={actor.userId} initialPage={initialPage} initialError={initialError} />;
}
