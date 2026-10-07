"use client";

import type { ReactNode } from "react";
import type { Theme } from "@/lib/brand";
import { NavigationGuardProvider } from "@/components/shells/navigation-guard";
import {
  DashboardShell,
  type NavSpec,
} from "@/components/shells/dashboard-shell";

// Infame adapts the retained Talaqee dashboard instead of defining a second shell.
export function AppShell({
  children,
  name,
  role,
  initialTheme,
}: {
  children: ReactNode;
  name: string;
  role: "CREATOR" | "BRAND" | "ADMIN";
  initialTheme: Theme;
}) {
  const dashboardRole =
    role === "CREATOR" ? "creator" : role === "BRAND" ? "brand" : "admin";
  const home = `/${dashboardRole}`;
  const nav: NavSpec[] = [
    { key: "home", label: { ar: "الرئيسية", en: "Overview" }, href: home },
    ...(role === "BRAND"
      ? [
          {
            key: "new",
            label: { ar: "حملة جديدة", en: "New campaign" },
            href: "/brand/campaigns/new",
          },
          {
            key: "brief",
            label: { ar: "موجز الحملة", en: "Campaign brief" },
            href: "/brand/brief",
          },
          {
            key: "matches",
            label: { ar: "صنّاع المحتوى", en: "Creator matches" },
            href: "/brand/matches",
          },
          {
            key: "creators",
            label: { ar: "استكشف صنّاع المحتوى", en: "Explore creators" },
            href: "/brand/creators",
          },
          {
            key: "campaigns",
            label: { ar: "حملاتي", en: "Campaigns" },
            href: "/brand/campaigns",
          },
          {
            key: "collections",
            label: { ar: "قوائم صنّاع المحتوى", en: "Creator collections" },
            href: "/brand/collections",
          },
          {
            key: "context",
            label: { ar: "سياق العلامة", en: "Brand context" },
            href: "/brand/context",
          },
        ]
      : []),
    ...(role !== "ADMIN"
      ? [
          {
            key: "deals",
            label: { ar: "الصفقات", en: "Deals" },
            href: home + "/deals",
          },
          {
            key: "profile",
            label: { ar: "ملفي", en: "My profile" },
            href: home + "/profile",
          },
          {
            key: "evidence",
            label: { ar: "الإثباتات", en: "Evidence" },
            href: home + "/evidence",
          },
          {
            key: "settings",
            label: { ar: "الإعدادات", en: "Settings" },
            href: home + "/settings",
          },
        ]
      : []),
  ];
  return (
    <NavigationGuardProvider>
    <DashboardShell
      role={dashboardRole}
      sidebarTitle={{ ar: name, en: name }}
      nav={nav}
      userName={name}
      userInitial={name.trim().charAt(0)}
      initialTheme={initialTheme}
    >
      {children}
    </DashboardShell>
    </NavigationGuardProvider>
  );
}
