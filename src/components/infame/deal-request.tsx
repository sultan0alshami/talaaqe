"use client";
import { useMemo, useRef, useState, useSyncExternalStore } from "react";

type PendingRequest = { path: string; body: Record<string, unknown> };
function subscribe(callback: () => void) {
  window.addEventListener("infame-deal-request-change", callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener("infame-deal-request-change", callback);
    window.removeEventListener("storage", callback);
  };
}
export function useDealRequest(userId: string, scope: string) {
  const key = `infame:deal-request:${userId}:${scope}`;
  const [busy, setBusy] = useState(false),
    [pendingLocal, setPendingLocal] = useState<
      PendingRequest | null | undefined
    >(undefined),
    [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const stored = useSyncExternalStore(
    subscribe,
    () => {
      try {
        return sessionStorage.getItem(key) ?? "";
      } catch {
        return "";
      }
    },
    () => "",
  );
  const restored = useMemo(() => {
    try {
      if (!stored) return null;
      const parsed: unknown = JSON.parse(stored);
      if (
        parsed &&
        typeof parsed === "object" &&
        "path" in parsed &&
        "body" in parsed &&
        typeof parsed.path === "string" &&
        parsed.path.startsWith("/api/deals") &&
        parsed.body &&
        typeof parsed.body === "object" &&
        !Array.isArray(parsed.body) &&
        "operationKey" in parsed.body &&
        typeof parsed.body.operationKey === "string"
      ) {
        return parsed as PendingRequest;
      }
    } catch {
      /* Unavailable browser storage does not prevent server-backed drafts. */
    }
    return null;
  }, [stored]);
  const pending = pendingLocal === undefined ? restored : pendingLocal;
  function remember(request: PendingRequest | null) {
    setPendingLocal(request);
    try {
      if (request) sessionStorage.setItem(key, JSON.stringify(request));
      else sessionStorage.removeItem(key);
      window.dispatchEvent(new Event("infame-deal-request-change"));
    } catch {
      /* Keep the current in-memory receipt. */
    }
  }
  async function run<T>(
    path: string,
    body: Record<string, unknown>,
    onSuccess: (data: T) => void,
  ): Promise<void> {
    if (
      inFlight.current ||
      (pending && pending.body.operationKey !== body.operationKey)
    )
      return;
    const request = { path, body };
    remember(request);
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        cache: "no-store",
      });
      const result = await response.json();
      if (!response.ok) {
        remember(null);
        setError(result.error?.code ?? "INTERNAL_ERROR");
        return;
      }
      // Clear only after a complete authoritative response. A lost/malformed
      // response retains the exact request key/body for replay after reload.
      if (!result || !("data" in result)) throw new Error("Invalid response");
      onSuccess(result.data as T);
      remember(null);
    } catch {
      setError("NETWORK");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  async function retry<T>(onSuccess: (data: T) => void) {
    if (pending) await run(pending.path, pending.body, onSuccess);
  }
  return {
    busy,
    pending,
    error: error ?? (pending && !busy ? "NETWORK" : null),
    setError,
    run,
    retry,
  };
}
