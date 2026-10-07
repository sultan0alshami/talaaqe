"use client";

import Link from "next/link";
import { ArrowLeft, ArrowRight, Check, Clapperboard, Fingerprint, Megaphone, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { INFAME_COPY } from "@/lib/infame-copy";
import { useI18n } from "@/lib/i18n";
import { InfameBrandPattern } from "./brand-pattern";

export function InfameLanding() {
  const { lang, isAr } = useI18n();
  const copy = INFAME_COPY[lang];
  const Arrow = isAr ? ArrowLeft : ArrowRight;
  return (
    <>
      <section className="infame-container infame-hero" aria-labelledby="hero-title">
        <div className="infame-hero-copy">
          <p className="infame-kicker"><span className="infame-small-dot" aria-hidden="true" />{copy.hero.eyebrow}</p>
          <h1 id="hero-title">{copy.hero.title}<br /><span>{copy.hero.emphasis}</span></h1>
          <p className="infame-lead">{copy.hero.body}</p>
          <div className="infame-hero-actions"><Button asChild size="lg"><Link href="/signup?role=company">{copy.hero.brandAction}<Arrow aria-hidden="true" /></Link></Button><Button asChild size="lg" variant="outline"><Link href="/signup?role=creator">{copy.hero.creatorAction}<Arrow aria-hidden="true" /></Link></Button></div>
          <p className="infame-quiet-note">{copy.hero.note}</p>
        </div>
        <div className="infame-story-panel">
          <p className="infame-story-kicker">{copy.hero.visualLabel}</p>
          <InfameBrandPattern />
          <div className="infame-story-words"><h2>{copy.hero.visualTitle}</h2><p>{copy.hero.visualSubtitle}</p></div>
          <ol className="infame-story-steps">{copy.hero.visualSteps.map((step, index) => <li key={step}><span dir="ltr">0{index + 1}</span>{step}</li>)}</ol>
          <p className="infame-story-footer">{copy.hero.visualFooter}</p>
        </div>
      </section>
      <section className="infame-section infame-journey-section" aria-labelledby="journey-title"><div className="infame-container"><p className="infame-kicker">{copy.journeys.eyebrow}</p><h2 id="journey-title" className="infame-section-title">{copy.journeys.title}</h2><div className="infame-journey-grid">
        {[{ key: "brands", content: copy.journeys.brands, href: "/for-brands", label: copy.journeys.brandLink, Icon: Megaphone }, { key: "creators", content: copy.journeys.creators, href: "/for-creators", label: copy.journeys.creatorLink, Icon: Clapperboard }].map(({ key, content, href, label, Icon }) => <Card key={key} className={`infame-journey-card infame-journey-${key}`}><CardHeader><span className="infame-icon-tile"><Icon size={26} strokeWidth={1.6} aria-hidden="true" /></span><h3>{content.title}</h3></CardHeader><CardContent><p>{content.body}</p><Link href={href} className="infame-text-link">{label}<Arrow size={18} aria-hidden="true" /></Link></CardContent></Card>)}
      </div></div></section>
      <section className="infame-section infame-container" aria-labelledby="process-title"><p className="infame-kicker">{copy.process.eyebrow}</p><h2 id="process-title" className="infame-section-title">{copy.process.title}</h2><ol className="infame-process-grid">{copy.process.items.map((item, index) => <li key={item.title}><span className="infame-step-number" dir="ltr">0{index + 1}</span><h3>{item.title}</h3><p>{item.body}</p></li>)}</ol></section>
      <section className="infame-section infame-trust-section" aria-labelledby="trust-title"><div className="infame-container infame-trust-grid"><div><p className="infame-kicker">{copy.trust.eyebrow}</p><h2 id="trust-title" className="infame-section-title">{copy.trust.title}</h2><p className="infame-lead">{copy.trust.body}</p></div><div className="infame-trust-list"><Fingerprint size={42} strokeWidth={1.3} aria-hidden="true" /><ul>{copy.trust.items.map((item) => <li key={item}><Check size={18} aria-hidden="true" /><span>{item}</span></li>)}</ul></div></div></section>
      <section className="infame-section infame-container infame-faq" aria-labelledby="faq-title"><h2 id="faq-title" className="infame-section-title">{copy.faq.title}</h2><div>{copy.faq.items.map(({ question, answer }) => <details key={question}><summary><span>{question}</span><Plus size={20} aria-hidden="true" /></summary><p>{answer}</p></details>)}</div></section>
      <section className="infame-container infame-close" aria-labelledby="close-title"><div><h2 id="close-title">{copy.close.title}</h2><p>{copy.close.body}</p></div><Button asChild size="lg"><Link href="/signup">{copy.close.action}<Arrow aria-hidden="true" /></Link></Button></section>
    </>
  );
}
