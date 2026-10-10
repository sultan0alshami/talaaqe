"use client";

import { useEffect, useRef, useState } from "react";
import { Download, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogClose, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { useI18n } from "@/lib/i18n";
import { InfameBrandPattern } from "./brand-pattern";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform?: string }>;
};
type RegistrationState = "registering" | "registered" | "unsupported" | "insecure" | "failed";
type PromptState = "idle" | "prompting" | "accepted" | "dismissed" | "failed" | "reported";

// One registration attempt is shared across development Strict Mode remounts.
// Rejection remains sticky until a user explicitly requests a retry.
let registrationAttempt: Promise<ServiceWorkerRegistration> | null = null;
function registerPublicWorker(retry = false) {
  if (!registrationAttempt || retry) {
    registrationAttempt = Promise.resolve().then(() => navigator.serviceWorker.register("/sw.js", {
      scope: "/", updateViaCache: "none",
    }));
  }
  return registrationAttempt;
}

const COPY = {
  ar: {
    trigger: "تثبيت إنفيم", title: "إنفيم على جهازك", close: "إغلاق",
    description: "افتح إنفيم من الشاشة الرئيسية، إذا كان متصفحك يدعم التثبيت.",
    registering: "جارٍ تسجيل دعم المتصفح…",
    registered: "تم تسجيل دعم المتصفح. يحدد متصفحك خيارات التثبيت المتاحة.",
    unsupported: "لا يدعم هذا المتصفح عامل الخدمة. يمكنك متابعة استخدام الموقع بشكل عادي.",
    insecure: "يتطلب دعم التثبيت اتصالًا آمنًا. يمكنك متابعة استخدام الموقع بشكل عادي.",
    registrationFailed: "تعذّر تسجيل دعم المتصفح. لم نتحقق من توفر صفحة انقطاع الاتصال.",
    retry: "إعادة محاولة التسجيل", install: "فتح طلب التثبيت", prompting: "بانتظار اختيارك في المتصفح…",
    accepted: "قبلت طلب التثبيت. يتولى المتصفح إتمامه؛ يمكنك متابعة استخدام الموقع.",
    dismissed: "أغلقت طلب التثبيت. يمكنك متابعة استخدام الموقع بشكل عادي.",
    promptFailed: "تعذّر فتح طلب التثبيت أو معرفة نتيجته. استخدم خيارات التثبيت في المتصفح.",
    reported: "أبلغ المتصفح عن اكتمال التثبيت.",
    ios: "في Safari على iPhone أو iPad، افتح المشاركة، ثم اختر «إضافة إلى الشاشة الرئيسية» إذا ظهر الخيار.",
    menu: "إذا لم يظهر زر طلب التثبيت، تحقق من قائمة المتصفح بحثًا عن «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية». قد لا يتوفر الخيار في هذا المتصفح.",
    connection: "يحتاج حسابك وحملاتك إلى اتصال بالإنترنت. صفحة انقطاع الاتصال توضح حالة الاتصال فقط.",
  },
  en: {
    trigger: "Install Infame", title: "Infame on your device", close: "Close",
    description: "Open Infame from your home screen, when your browser supports installation.",
    registering: "Registering browser support…",
    registered: "Browser support is registered. Your browser determines which installation options are available.",
    unsupported: "This browser does not support service workers. You can keep using the website normally.",
    insecure: "Installation support requires a secure connection. You can keep using the website normally.",
    registrationFailed: "Browser support could not be registered. Offline notice availability has not been verified.",
    retry: "Retry registration", install: "Open installation request", prompting: "Waiting for your browser choice…",
    accepted: "You accepted the installation request. Your browser handles completion; you can keep using the website.",
    dismissed: "You dismissed the installation request. You can keep using the website normally.",
    promptFailed: "The installation request could not be opened or its result could not be read. Use your browser’s installation options.",
    reported: "Your browser reported that installation is complete.",
    ios: "In Safari on iPhone or iPad, open Share, then choose Add to Home Screen if that option is available.",
    menu: "If an installation request button is unavailable, check your browser menu for Install app or Add to Home Screen. Your browser may not offer either option.",
    connection: "Your account and campaigns need an internet connection. The offline notice only explains connectivity.",
  },
} as const;

export function PwaInstall() {
  const { lang, dir } = useI18n();
  const copy = COPY[lang];
  const [hydrated, setHydrated] = useState(false);
  const [standalone, setStandalone] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [registration, setRegistration] = useState<RegistrationState>("registering");
  const [promptState, setPromptState] = useState<PromptState>("idle");
  const [hasPrompt, setHasPrompt] = useState(false);
  const [open, setOpen] = useState(false);
  const deferredPrompt = useRef<InstallPromptEvent | null>(null);
  const prompting = useRef(false);
  const registering = useRef(false);
  const installedReported = useRef(false);
  const generation = useRef(0);
  const mounted = useRef(false);

  useEffect(() => {
    const lifetime = { mounted, generation, deferredPrompt, prompting, registering };
    mounted.current = true;
    const epoch = ++generation.current;
    const displayMode = window.matchMedia("(display-mode: standalone)");
    const syncDisplayMode = () => {
      if (!mounted.current || generation.current !== epoch) return;
      const active = displayMode.matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
      setStandalone(active);
      if (active) setOpen(false);
    };
    displayMode.addEventListener("change", syncDisplayMode);

    const supported = window.isSecureContext && "serviceWorker" in navigator;
    const capturePrompt = (event: Event) => {
      if (!supported || !mounted.current || generation.current !== epoch) return;
      const candidate = event as InstallPromptEvent;
      if (typeof candidate.prompt !== "function" || !candidate.userChoice ||
          typeof candidate.userChoice.then !== "function") return;
      event.preventDefault();
      if (prompting.current || deferredPrompt.current || installedReported.current) return;
      deferredPrompt.current = candidate;
      setHasPrompt(true);
      // A prior error/dismissal remains visible until the next user action.
    };
    const reportInstalled = (event: Event) => {
      if (!event.isTrusted || !mounted.current || generation.current !== epoch) return;
      deferredPrompt.current = null;
      installedReported.current = true;
      setHasPrompt(false);
      setPromptState("reported");
      syncDisplayMode();
    };
    window.addEventListener("beforeinstallprompt", capturePrompt);
    window.addEventListener("appinstalled", reportInstalled);

    queueMicrotask(() => {
      if (!mounted.current || generation.current !== epoch) return;
      syncDisplayMode();
      setIsIOS(/iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));
      setHydrated(true);
      if (!window.isSecureContext) {
        setRegistration("insecure");
      } else if (!("serviceWorker" in navigator)) {
        setRegistration("unsupported");
      } else {
        registering.current = true;
        void registerPublicWorker().then(() => {
          if (mounted.current && generation.current === epoch) setRegistration("registered");
        }, () => {
          if (mounted.current && generation.current === epoch) setRegistration("failed");
        }).finally(() => {
          if (mounted.current && generation.current === epoch) registering.current = false;
        });
      }
    });
    return () => {
      lifetime.mounted.current = false;
      lifetime.generation.current++;
      lifetime.deferredPrompt.current = null;
      lifetime.prompting.current = false;
      lifetime.registering.current = false;
      displayMode.removeEventListener("change", syncDisplayMode);
      window.removeEventListener("beforeinstallprompt", capturePrompt);
      window.removeEventListener("appinstalled", reportInstalled);
    };
  }, []);

  async function retryRegistration() {
    if (!mounted.current || registering.current || !window.isSecureContext ||
        !("serviceWorker" in navigator) || registration !== "failed") return;
    const epoch = generation.current;
    registering.current = true;
    setRegistration("registering");
    try {
      await registerPublicWorker(true);
      if (mounted.current && generation.current === epoch) setRegistration("registered");
    } catch {
      if (mounted.current && generation.current === epoch) setRegistration("failed");
    } finally {
      if (mounted.current && generation.current === epoch) registering.current = false;
    }
  }

  async function requestInstallation() {
    const event = deferredPrompt.current;
    if (!mounted.current || prompting.current || !event || standalone) return;
    const epoch = generation.current;
    prompting.current = true;
    deferredPrompt.current = null;
    setHasPrompt(false);
    setPromptState("prompting");
    try {
      await event.prompt();
      const choice = await event.userChoice;
      if (!mounted.current || generation.current !== epoch || installedReported.current) return;
      if (choice.outcome !== "accepted" && choice.outcome !== "dismissed") {
        setPromptState("failed");
      } else {
        setPromptState(choice.outcome);
      }
    } catch {
      if (mounted.current && generation.current === epoch && !installedReported.current) setPromptState("failed");
    } finally {
      if (mounted.current && generation.current === epoch) prompting.current = false;
    }
  }

  if (!hydrated || standalone) return null;
  const registrationMessage = registration === "failed" ? copy.registrationFailed : copy[registration];
  const promptMessage = promptState === "idle" ? null :
    promptState === "failed" ? copy.promptFailed : copy[promptState];
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="max-w-full justify-start whitespace-normal text-start" data-pwa-install-trigger>
          <Download aria-hidden="true" />{copy.trigger}
        </Button>
      </DialogTrigger>
      <DialogContent dir={dir} lang={lang} showCloseButton={false} className="sm:max-w-md motion-reduce:animate-none motion-reduce:transition-none" data-pwa-install-dialog>
        <div className="flex items-center justify-between gap-3">
          <InfameBrandPattern compact />
          <DialogClose asChild><Button type="button" variant="ghost" size="icon" aria-label={copy.close}><X aria-hidden="true" /></Button></DialogClose>
        </div>
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground" role={registration === "failed" ? "alert" : "status"} aria-live="polite" data-pwa-registration-status={registration}>{registrationMessage}</p>
        {promptMessage && <p className="text-sm" role={promptState === "failed" ? "alert" : "status"} aria-live="polite" data-pwa-prompt-status={promptState}>{promptMessage}</p>}
        <p className="text-sm leading-relaxed" data-pwa-install-instructions>{isIOS ? copy.ios : copy.menu}</p>
        <p className="text-sm text-muted-foreground">{copy.connection}</p>
        <DialogFooter>
          <DialogClose asChild><Button type="button" variant="outline" className="whitespace-normal">{copy.close}</Button></DialogClose>
          {registration === "failed" && <Button type="button" variant="outline" onClick={() => void retryRegistration()} className="whitespace-normal" data-pwa-registration-retry>{copy.retry}</Button>}
          {hasPrompt && <Button type="button" onClick={() => void requestInstallation()} disabled={promptState === "prompting"} className="whitespace-normal" data-pwa-install-request>{copy.install}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
