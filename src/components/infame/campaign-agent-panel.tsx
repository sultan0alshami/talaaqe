"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CampaignAgentInterview, type CampaignAgentInterviewProps, type CampaignAgentBrowserAdapter } from "./campaign-agent-interview";
import { CampaignAgentBrowserError } from "@/lib/campaign-agent/browser";
import { campaignAgentRecoveryKeyBinding } from "@/lib/campaign-agent/browser-storage";
import { createCampaignAgentRecoveryBrowserAdapter, readCampaignAgentResponse } from "@/lib/campaign-agent/browser-transport";
import type { PlanningScope } from "@/lib/brand-context/contracts";
import type { AgentBinding } from "@/lib/campaign-agent/contracts";

type Props = Omit<CampaignAgentInterviewProps, "binding" | "adapter"> & { scope: PlanningScope; campaignId: string };
export function CampaignAgentPanel(props: Props) {
  const { isAr } = useI18n();
  const [fixed] = useState(() => ({ scope: props.scope, campaignId: props.campaignId, actorReference: props.actorReference, privacyEpoch: props.privacyEpoch }));
  const latest = useRef(props);
  useEffect(() => { latest.current = props; }, [props]);
  const [ready, setReady] = useState<{ binding: AgentBinding; adapter: CampaignAgentBrowserAdapter } | null>(null);
  const [error, setError] = useState(false), [attempt, setAttempt] = useState(0);
  const [denied, setDenied] = useState(false), deniedRef = useRef(false);
  const active = useRef<AbortController | null>(null);
  const invalidate = useCallback((status: number) => {
    if (deniedRef.current) return;
    deniedRef.current = true; active.current?.abort(); setReady(null); setDenied(true);
    latest.current.onRecoveryState({ pending: false, busy: false, dirty: false, denied: true });
    void status;
  }, []);
  const registerPrivateDenial = props.registerPrivateDenial;
  useEffect(() => registerPrivateDenial(invalidate), [registerPrivateDenial, invalidate]);
  useEffect(() => {
    const controller = new AbortController(); active.current = controller; let alive = true;
    const current = () => alive && !controller.signal.aborted && !deniedRef.current && latest.current.privacyEpoch === fixed.privacyEpoch;
    queueMicrotask(() => {
      if (!current()) return;
      latest.current.onRecoveryState({ pending: true, busy: true, dirty: false, denied: false });
      const query = new URLSearchParams(fixed.scope.kind === "OWN_BRAND"
        ? { scope: "OWN_BRAND", brandId: fixed.scope.brandId } : { scope: "CLIENT", clientId: fixed.scope.clientId });
      query.set("campaignId", fixed.campaignId);
      void (async () => {
        try {
          const response = await fetch("/api/campaign-agent/recovery-key?" + query, { credentials: "same-origin", cache: "no-store", redirect: "error", signal: controller.signal });
          if (!current()) return;
          if ([401, 403, 404].includes(response.status)) {
            invalidate(response.status); latest.current.onDeny(); return;
          }
          if (!response.ok || response.headers.get("cache-control") !== "private, no-store") throw new CampaignAgentBrowserError();
          const envelope = await readCampaignAgentResponse(response, controller.signal, 8192); if (!current()) return;
          if (!envelope || typeof envelope !== "object" || !("data" in envelope)) throw new CampaignAgentBrowserError();
          const binding = campaignAgentRecoveryKeyBinding(envelope.data, fixed.actorReference, fixed.scope, fixed.campaignId); if (!current()) return;
          const adapter = createCampaignAgentRecoveryBrowserAdapter({ actorReference: fixed.actorReference, binding, storage: sessionStorage,
            onDeny: status => { invalidate(status); latest.current.onDeny(); } });
          setError(false); setReady({ binding, adapter });
        } catch {
          if (current()) { setError(true); latest.current.onRecoveryState({ pending: true, busy: false, dirty: false, denied: false }); }
        }
      })();
    });
    return () => { alive = false; controller.abort(); };
  }, [attempt, fixed, invalidate]);
  if (denied || props.privacyEpoch !== fixed.privacyEpoch) return null;
  if (ready) return <CampaignAgentInterview {...props} binding={ready.binding} adapter={ready.adapter} />;
  return <Card aria-busy={!error}><CardContent className="space-y-3 pt-6">
    <p role={error ? "alert" : "status"}>{isAr ? error ? "تعذّر تحميل المقابلة بأمان." : "جارٍ تحميل المقابلة…" : error ? "The interview could not be loaded safely." : "Loading the interview…"}</p>
    {error && <Button variant="outline" onClick={() => { setError(false); setAttempt(value => value + 1); }}>{isAr ? "أعد المحاولة" : "Try again"}</Button>}
  </CardContent></Card>;
}
