"use client";

import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { INFAME_COPY, type InformationKind } from "@/lib/infame-copy";
import { useI18n } from "@/lib/i18n";

export function InformationPage({ kind }: { kind: InformationKind }) {
  const { lang, isAr } = useI18n();
  const copy = INFAME_COPY[lang].information[kind];
  const Arrow = isAr ? ArrowLeft : ArrowRight;
  return (
    <article className="infame-container infame-information">
      <header>
        <p className="infame-kicker">{copy.eyebrow}</p>
        <h1>{copy.title}</h1>
        <p className="infame-lead">{copy.intro}</p>
      </header>
      <div className="infame-information-grid">
        {copy.sections.map((section, index) => (
          <Card key={section.title} className="infame-information-card">
            <CardHeader>
              <span className="infame-step-number" dir="ltr">0{index + 1}</span>
              <h2>{section.title}</h2>
            </CardHeader>
            <CardContent><p>{section.body}</p></CardContent>
          </Card>
        ))}
      </div>
      <aside className="infame-information-note"><p>{copy.note}</p></aside>
      <div className="infame-information-actions flex flex-wrap gap-3">
        <Button asChild size="lg">
          <Link href={copy.href}>{copy.action}<Arrow aria-hidden="true" /></Link>
        </Button>
        {kind === "contact" && (
          <Button asChild size="lg" variant="outline">
            <Link href="/login">{INFAME_COPY[lang].nav.login}</Link>
          </Button>
        )}
      </div>
    </article>
  );
}
