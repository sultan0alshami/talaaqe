"use client";

import { PublicNav } from "./public-nav";
import { PublicFooter } from "./public-footer";
import { useI18n } from "@/lib/talaqee-site/i18n";
import styles from "./classic.module.css";

// Original Talaqee public composition, scoped to the alternate website.
export function ClassicShell({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  return <div className={styles.site}>
    <a href="#classic-main" className={styles.skip}>{t.skipLabel}</a>
    <PublicNav />
    <main id="classic-main" tabIndex={-1} className={styles.main}>{children}</main>
    <PublicFooter />
  </div>;
}
