"use client";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle2, Loader2 } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import styles from "./auth-screen.module.css";

type Mode = "login" | "signup" | "forgot" | "reset" | "verify";
export function AuthScreen({ mode, initialRole, next, token, websiteBase = "/" }: { mode: Mode; initialRole?: string; next?: string; token?: string; websiteBase?: "/" | "/classic" }) {
  const { isAr } = useI18n();
  const router = useRouter();
  const [role, setRole] = useState(initialRole === "company" || initialRole === "brand" ? "BRAND" : "CREATOR");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [complete, setComplete] = useState(false);
  const [delivery, setDelivery] = useState("");
  const copy = (ar: string, en: string) => isAr ? ar : en;
  const websitePath = (path: string) => websiteBase === "/classic" ? `/classic${path}` : path;
  const title = mode === "login" ? copy("أهلًا برجعتك", "Welcome back")
    : mode === "signup" ? copy("بدايتك مع إنفيم", "Start with Infame")
    : mode === "forgot" ? copy("استعادة كلمة المرور", "Recover your password")
    : mode === "reset" ? copy("كلمة مرور جديدة", "A new password")
    : copy("تأكيد بريدك الإلكتروني", "Verify your email");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError("");
    const values = new FormData(event.currentTarget);
    const endpoint = mode === "forgot" ? "recover" : mode === "reset" ? "reset" : mode === "verify" ? "verify-email" : mode;
    const body = mode === "verify" ? { token }
      : mode === "reset" ? { token, password: values.get("password") }
      : mode === "forgot" ? { email: values.get("email") }
      : mode === "login" ? { email: values.get("email"), password: values.get("password") }
      : { name: values.get("name"), email: values.get("email"), password: values.get("password"), role, language: isAr ? "ar" : "en" };
    try {
      const response = await fetch(`/api/auth/${endpoint}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json();
      if (!response.ok) {
        setError(response.status === 429 ? copy("محاولات كثيرة. انتظر شوي وجرب مرة ثانية.", "Too many attempts. Wait a moment and try again.")
          : response.status === 409 ? copy("هذا البريد مسجل. تقدر تدخل أو تستعيد كلمة المرور.", "This email is registered. Sign in or recover your password.")
          : mode === "login" ? copy("راجع بريدك وكلمة المرور.", "Check your email and password.")
          : mode === "verify" || mode === "reset" ? copy("الرابط غير صالح أو انتهت مدته. اطلب رابطًا جديدًا.", "This link is invalid or expired. Request a new one.")
          : copy("راجع البيانات. كلمة المرور تحتاج 12 حرفًا على الأقل.", "Check your details. Your password needs at least 12 characters."));
        return;
      }
      if (mode === "signup" || mode === "login") {
        const home = data.user.role === "BRAND" ? "/brand" : data.user.role === "ADMIN" ? "/admin" : "/creator";
        const destination = next && /^\/(?![\/\\])/.test(next) && !next.includes("\\") ? next : home;
        router.push(destination); router.refresh();
      } else { setComplete(true); setDelivery(data.delivery ?? ""); }
    } catch { setError(copy("ما قدرنا نتصل. بياناتك موجودة، جرّب مرة ثانية.", "We couldn't connect. Your input is retained; try again.")); }
    finally { setBusy(false); }
  }
  return <section className="flex min-h-[calc(100vh-220px)] w-full items-center justify-center px-6 py-[60px]">
    <Card className={`w-full gap-0 rounded-[22px] border border-border p-6 shadow-[0_20px_60px_rgba(0,0,0,.08)] ring-0 sm:p-10 ${mode === "signup" ? "max-w-[560px]" : "max-w-[430px]"}`}>
      <div className="mb-6 text-center">
        {mode === "login" && <span aria-hidden="true" className="infame-brand-dot mb-3 inline-block" style={{ width: 52, height: 51 }} />}
        <h1 className="text-[22px] font-bold">{title}</h1>
        <p className="text-sm text-muted-foreground">{copy("تواصل واضح بين صُنّاع المحتوى والعلامات التجارية.", "Clear collaboration between creators and brands.")}</p>
      </div>
      <CardContent className="p-0">
        {complete ? <div role="status" className="space-y-5"><CheckCircle2 className="size-8 text-success" aria-hidden="true" />
          <p>{mode === "forgot" ? copy("إذا كان البريد مسجلًا، سنرسل رابط الاستعادة عندما تكون خدمة البريد متاحة.", "If this email is registered, a recovery link is sent when email delivery is available.")
            : mode === "reset" ? copy("تغيّرت كلمة المرور. ادخل من جديد.", "Your password changed. Sign in again.")
            : copy("تم تأكيد بريدك.", "Your email is verified.")}</p>
          {delivery === "fixture" && <p className="text-sm text-muted-foreground">{copy("بيئة تطوير: الرسالة محفوظة في صندوق الاختبار المحلي.", "Development environment: the message is in the local test inbox.")}</p>}
          {delivery === "unavailable" && <p className="text-sm text-muted-foreground">{copy("خدمة إرسال البريد غير مفعلة حاليًا.", "Email delivery is currently unavailable.")}</p>}
          <Button asChild variant="outline"><Link href={websitePath("/login")}>{copy("الدخول", "Sign in")}</Link></Button>
        </div> : <form onSubmit={submit} className={`${styles.fields} space-y-3.5`} aria-busy={busy}>
          {mode === "signup" && <>
            <fieldset><legend className="mb-2 text-sm font-medium">{copy("كيف بتستخدم إنفيم؟", "How will you use Infame?")}</legend>
              <div className="mb-2 grid grid-cols-2 gap-3">{(["BRAND", "CREATOR"] as const).map((value) => <button key={value} type="button" aria-pressed={role === value} onClick={() => setRole(value)} className={`rounded-[14px] border-2 p-4 text-start ${role === value ? "border-foreground bg-accent" : "border-border bg-card"}`} aria-label={value === "CREATOR" ? copy("صانع محتوى", "Creator") : copy("علامة تجارية", "Brand")}>
                <span className="mb-[3px] block text-[15px] font-bold">{value === "CREATOR" ? copy("صانع محتوى", "Creator") : copy("علامة تجارية", "Brand")}</span>
                <span className="block text-[12.5px] text-muted-foreground">{value === "CREATOR" ? copy("أعرض محتواي وأتابع تعاوناتي", "Show my work and manage collaborations") : copy("أجهّز حملاتي وأختار صنّاع المحتوى", "Plan campaigns and find creators")}</span>
              </button>)}</div></fieldset>
            <div className="space-y-2"><label htmlFor="auth-name">{copy("الاسم", "Name")}</label><Input id="auth-name" name="name" autoComplete="name" required minLength={2} maxLength={120} /></div>
          </>}
          {["signup", "login", "forgot"].includes(mode) && <div className="space-y-2"><label htmlFor="auth-email">{copy("البريد الإلكتروني", "Email")}</label><Input id="auth-email" name="email" type="email" dir="ltr" autoComplete="email" required maxLength={254} placeholder="you@example.com" /></div>}
          {["signup", "login", "reset"].includes(mode) && <div className="space-y-2"><label htmlFor="auth-password">{copy("كلمة المرور", "Password")}</label><Input id="auth-password" name="password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={mode === "login" ? 1 : 12} maxLength={72} aria-describedby={mode === "login" ? undefined : "password-help"} />
            {mode !== "login" && <p id="password-help" className="text-sm text-muted-foreground">{copy("12 حرفًا على الأقل. استخدم كلمة مرور خاصة بإنفيم.", "At least 12 characters. Use a password unique to Infame.")}</p>}</div>}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button className="h-auto w-full rounded-[11px] px-3 py-[13px] text-[15px] font-bold" type="submit" disabled={busy || ((mode === "reset" || mode === "verify") && !token)}>{busy && <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}
            {mode === "login" ? copy("الدخول", "Sign in") : mode === "signup" ? copy("إنشاء حساب", "Create account") : mode === "forgot" ? copy("طلب رابط الاستعادة", "Request recovery link") : mode === "reset" ? copy("حفظ كلمة المرور", "Save password") : copy("تأكيد البريد", "Verify email")}</Button>
          {mode === "login" && <div className="flex flex-wrap justify-between gap-3 text-sm"><Link className="underline underline-offset-4" href={websitePath("/forgot-password")}>{copy("نسيت كلمة المرور؟", "Forgot your password?")}</Link><Link className="underline underline-offset-4" href={websitePath("/signup")}>{copy("إنشاء حساب", "Create account")}</Link></div>}
          {mode === "signup" && <p className="text-center text-[13px] text-muted-foreground">{copy("عندك حساب؟", "Already have an account?")} <Link href={websitePath("/login")} className="font-bold text-foreground underline underline-offset-4">{copy("ادخل", "Sign in")}</Link></p>}
          {(mode === "reset" || mode === "verify") && !token && <p role="status" className="text-sm text-muted-foreground">{copy("افتح الرابط الذي وصلك بالبريد.", "Open the link from your email.")}</p>}
        </form>}
        <Link href={websiteBase} className="mt-6 inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground"><ArrowLeft className="size-4 rtl:rotate-180" aria-hidden="true" />{copy("الرجوع لإنفيم", "Back to Infame")}</Link>
      </CardContent>
    </Card>
  </section>;
}
