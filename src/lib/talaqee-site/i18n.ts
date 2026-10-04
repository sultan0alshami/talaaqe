"use client";

import { useI18n as useSharedI18n } from "@/lib/i18n";
import { CLASSIC_COPY } from "./copy";

// Use the shared locale and controls; keep this site's copy local to its subtree.
export function useI18n() {
  const shared = useSharedI18n();
  return { ...shared, t: CLASSIC_COPY[shared.lang] };
}
