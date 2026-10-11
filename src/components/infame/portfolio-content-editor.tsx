"use client";
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { PortfolioContent } from "@/lib/onboarding/portfolio-contract";

const subscribeReady = () => () => {};
const clientReady = () => true, serverReady = () => false;
type Props = { content: PortfolioContent; onChange: (content: PortfolioContent) => boolean;
  disabled: boolean; readOnly: boolean; dirty: boolean };
export function PortfolioContentEditor({ content, onChange, disabled, readOnly, dirty }: Props) {
  const { isAr } = useI18n(), copy = (ar: string, en: string) => isAr ? ar : en;
  const ready = useSyncExternalStore(subscribeReady, clientReady, serverReady), id = useId();
  const [keys, setKeys] = useState(() => content.sections.map((_, index) => "section-" + index));
  const serial = useRef(content.sections.length), headings = useRef(new Map<string, HTMLInputElement>());
  const addButton = useRef<HTMLButtonElement>(null), focusAfter = useRef<string | null>(null);
  const unavailable = disabled || !ready, locked = unavailable || readOnly;
  useEffect(() => {
    const key = focusAfter.current;
    if (key === null) return;
    focusAfter.current = null;
    if (key === "add") addButton.current?.focus(); else headings.current.get(key)?.focus();
  }, [keys]);
  function change(value: PortfolioContent) { return !locked && onChange({ ...value, method: "APPROVED_FACT_TEMPLATE" }); }
  function section(index: number, patch: Partial<PortfolioContent["sections"][number]>) {
    change({ ...content, sections: content.sections.map((row, at) => at === index ? { ...row, ...patch } : row) });
  }
  function add() {
    if (locked || content.sections.length >= 20) return;
    const key = "section-" + serial.current++;
    if (!change({ ...content, sections: [...content.sections, { heading: "", text: "" }] })) return;
    focusAfter.current = key; setKeys([...keys, key]);
  }
  function remove(index: number) {
    if (locked) return;
    const next = keys.filter((_, at) => at !== index);
    if (!change({ ...content, sections: content.sections.filter((_, at) => at !== index) })) return;
    focusAfter.current = next[Math.min(index, next.length - 1)] ?? "add";
    setKeys(next);
  }
  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (locked || target < 0 || target >= content.sections.length) return;
    const rows = [...content.sections], nextKeys = [...keys];
    [rows[index], rows[target]] = [rows[target]!, rows[index]!];
    [nextKeys[index], nextKeys[target]] = [nextKeys[target]!, nextKeys[index]!];
    if (!change({ ...content, sections: rows })) return;
    focusAfter.current = keys[index]!; setKeys(nextKeys);
  }
  return <div data-portfolio-content-editor="" className="min-w-0 space-y-5">
    <p data-portfolio-content-status="" role="status" className="text-sm text-muted-foreground">
      {readOnly ? copy("نسخة معتمدة للقراءة. أنشئ نسخة جديدة لتعديلها.", "Approved version is read-only. Create a new version to edit.")
        : dirty ? copy("تعديلاتك في هذه الصفحة؛ اعتمد النسخة لحفظها.", "Your edits are on this page; approve the version to save them.")
          : copy("راجع كل محتوى هذه النسخة قبل اعتمادها.", "Review this version’s complete content before approving it.")}
    </p>
    <label htmlFor={id + "-title"} className="block space-y-2"><span>{copy("عنوان الملف", "Portfolio title")}</span>
      <Input id={id + "-title"} data-portfolio-title="" dir="auto" maxLength={200} value={content.title}
        disabled={unavailable} readOnly={readOnly} onChange={event => change({ ...content, title: event.target.value })} />
    </label>
    <label htmlFor={id + "-bio"} className="block space-y-2"><span>{copy("نبذة الملف", "Portfolio overview")}</span>
      <Textarea id={id + "-bio"} data-portfolio-bio="" aria-label={copy("نبذة الملف", "Portfolio overview")} dir="auto" rows={6} className="text-base" maxLength={1000} value={content.bio}
        disabled={unavailable} readOnly={readOnly} onChange={event => change({ ...content, bio: event.target.value })} />
    </label>
    <fieldset className="min-w-0 space-y-4"><legend className="font-semibold">{copy("أقسام الملف", "Portfolio sections")}</legend>
      <p data-portfolio-section-count="" aria-live="polite" className="text-sm text-muted-foreground">
        <bdi>{content.sections.length} / 20</bdi> {copy("قسم", "sections")}
      </p>
      {content.sections.map((row, index) => {
        const key = keys[index]!, headingId = id + "-" + key + "-heading", textId = id + "-" + key + "-text";
        const descriptor = copy("القسم ", "section ") + (index + 1) + (row.heading ? ": " + row.heading : "");
        return <section key={key} data-portfolio-section="" data-portfolio-section-key={key} data-portfolio-section-index={index + 1}
          className="min-w-0 space-y-3 rounded-lg border p-4" aria-label={copy("القسم ", "Section ") + (index + 1)}>
          <label htmlFor={headingId} className="block space-y-2"><span>{copy("عنوان القسم ", "Section ") + (index + 1) + copy("", " heading")}</span>
            <Input id={headingId} data-portfolio-section-heading="" dir="auto" maxLength={100} value={row.heading} disabled={unavailable} readOnly={readOnly}
              ref={node => { if (node) headings.current.set(key, node); else headings.current.delete(key); }} onChange={event => section(index, { heading: event.target.value })} />
          </label>
          <label htmlFor={textId} className="block space-y-2"><span>{copy("نص القسم ", "Section ") + (index + 1) + copy("", " text")}</span>
            <Textarea id={textId} data-portfolio-section-text="" aria-label={copy("نص القسم ", "Section ") + (index + 1) + copy("", " text")} dir="auto" rows={4} className="text-base" maxLength={2000} value={row.text}
              disabled={unavailable} readOnly={readOnly} onChange={event => section(index, { text: event.target.value })} />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" data-portfolio-move="up" className="min-h-11 whitespace-normal" disabled={locked || index === 0}
              aria-label={copy("انقل ", "Move ") + descriptor + copy(" للأعلى", " up")} onClick={() => move(index, -1)}><ArrowUp aria-hidden="true" />{copy("للأعلى", "Move up")}</Button>
            <Button type="button" variant="outline" data-portfolio-move="down" className="min-h-11 whitespace-normal" disabled={locked || index === content.sections.length - 1}
              aria-label={copy("انقل ", "Move ") + descriptor + copy(" للأسفل", " down")} onClick={() => move(index, 1)}><ArrowDown aria-hidden="true" />{copy("للأسفل", "Move down")}</Button>
            <Button type="button" variant="ghost" data-portfolio-remove-section="" className="min-h-11 whitespace-normal" disabled={locked}
              aria-label={copy("احذف ", "Remove ") + descriptor} onClick={() => remove(index)}><Trash2 aria-hidden="true" />{copy("احذف القسم", "Remove section")}</Button>
          </div>
        </section>;
      })}
      <Button ref={addButton} type="button" variant="outline" data-portfolio-add-section="" className="min-h-11" disabled={locked || content.sections.length >= 20}
        onClick={add}><Plus aria-hidden="true" />{copy("أضف قسمًا", "Add section")}</Button>
    </fieldset>
  </div>;
}
