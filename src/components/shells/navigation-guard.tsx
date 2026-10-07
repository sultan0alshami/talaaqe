"use client";

import NextLink from "next/link";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, type ComponentProps, type ReactNode } from "react";

export type NavigationGuard = { isBlocked: () => boolean;
  requestLeave: (continueNavigation: () => void, opener: HTMLElement | null) => void };
export type NavigationGuardRegistrar = (guard: NavigationGuard) => () => void;
type Registration = { guard: NavigationGuard; identity: symbol };
type Entry = { key: string; index: number; url: string | null };
type TraverseEvent = Event & { navigationType: string; destination: Entry & { sameDocument: boolean } };
type NativeNavigation = { currentEntry: Entry | null;
  addEventListener(type: "navigate", listener: (event: TraverseEvent) => void): void;
  removeEventListener(type: "navigate", listener: (event: TraverseEvent) => void): void;
  traverseTo(key: string): { finished: Promise<unknown> } };
type Boundary = { register: NavigationGuardRegistrar;
  request: (continueNavigation: () => void, opener: HTMLElement | null) => boolean };
const Context = createContext<Boundary | null>(null);

export function NavigationGuardProvider({ children }: { children: ReactNode }) {
  const registered = useRef<Registration | null>(null);
  const restoringRequest = useRef<((proceed: () => void, opener: HTMLElement | null, registration: Registration) => void) | null>(null);
  const register = useCallback<NavigationGuardRegistrar>(guard => {
    const registration = { guard, identity: Symbol("navigation-guard") };
    registered.current = registration;
    return () => { if (registered.current === registration) registered.current = null; };
  }, []);
  const request = useCallback((proceed: () => void, opener: HTMLElement | null) => {
    const registration = registered.current;
    if (!registration) return false;
    // Consult the leaf even when a render's isBlocked value is stale: pending
    // capture is synchronous, and the leaf's requestLeave is authoritative.
    if (restoringRequest.current) { restoringRequest.current(proceed, opener, registration); return true; }
    let consumed = false;
    registration.guard.requestLeave(() => {
      if (consumed || registered.current !== registration) return;
      consumed = true; proceed();
    }, opener);
    return true;
  }, []);
  useEffect(() => {
    const native = (window as Window & { navigation?: NativeNavigation }).navigation;
    if (!native) return; // Existing beforeunload still covers full-document exits.
    type CapturedTraversal = { source: Entry; destination: Entry; registration: Registration; opener: HTMLElement | null };
    let traversal: CapturedTraversal | null = null;
    let phase: "IDLE" | "RESTORING" | "LEAVING" = "IDLE";
    let bypassKey: string | null = null, disposed = false, attempt = 0, restorationCount = 0;
    let pinned: CapturedTraversal | null = null;
    let queued: { proceed: () => void; opener: HTMLElement | null; registration: Registration } | null = null;
    const clearRestoration = (ownAttempt: number) => {
      if (disposed || ownAttempt !== attempt) return;
      ++attempt; phase = "IDLE"; pinned = null; restoringRequest.current = null; queued = null; traversal = null; restorationCount = 0;
    };
    const restore = (captured: CapturedTraversal) => {
      phase = "RESTORING"; pinned = captured;
      const ownAttempt = ++attempt;
      if (++restorationCount > 4) { clearRestoration(ownAttempt); return; }
      restoringRequest.current = (proceed, opener, registration) => { queued = { proceed, opener, registration }; };
      let finished: Promise<unknown>;
      try { finished = native.traverseTo(captured.source.key).finished; }
      catch { clearRestoration(ownAttempt); return; }
      void finished.then(() => {
        if (disposed || ownAttempt !== attempt) return;
        if (native.currentEntry?.key !== captured.source.key) { restore(captured); return; }
        phase = "IDLE"; pinned = null; restoringRequest.current = null; restorationCount = 0;
        if (registered.current !== captured.registration || location.href !== captured.source.url) { queued = null; return; }
        const newer = queued; queued = null;
        const registration = newer?.registration ?? captured.registration;
        if (registered.current !== registration) return;
        let consumed = false;
        registration.guard.requestLeave(() => {
          if (consumed || disposed || registered.current !== registration || ownAttempt !== attempt
            || native.currentEntry?.key !== captured.source.key) return;
          consumed = true;
          if (newer) { newer.proceed(); return; }
          phase = "LEAVING"; bypassKey = captured.destination.key;
          const leavingAttempt = ++attempt;
          try {
            void native.traverseTo(captured.destination.key).finished.catch(() => {
              if (!disposed && leavingAttempt === attempt) { phase = "IDLE"; bypassKey = null; }
            });
          } catch { if (leavingAttempt === attempt) { phase = "IDLE"; bypassKey = null; } }
        }, newer?.opener ?? captured.opener);
      }).catch((failure: unknown) => {
        if (disposed || ownAttempt !== attempt) return;
        // An interrupted traversal must restore the same pinned editor before
        // any older dialog/continuation can take over the newer request.
        if (failure instanceof DOMException && failure.name === "AbortError" && native.currentEntry?.key !== captured.source.key
          && restorationCount < 4) restore(captured);
        else clearRestoration(ownAttempt);
      });
    };
    const observe = (event: TraverseEvent) => {
      if (disposed || event.navigationType !== "traverse" || !event.destination.sameDocument || phase !== "IDLE") return;
      const registration = registered.current, source = native.currentEntry;
      if (!registration || !source?.key || !source.url || !event.destination.key || source.key === event.destination.key) return;
      traversal = { source: { key: source.key, index: source.index, url: source.url },
        destination: { key: event.destination.key, index: event.destination.index, url: event.destination.url }, registration,
        opener: document.activeElement instanceof HTMLElement ? document.activeElement : null };
    };
    const onPop = (event: PopStateEvent) => {
      const current = native.currentEntry;
      if (phase === "LEAVING" && current?.key === bypassKey) {
        phase = "IDLE"; bypassKey = null; traversal = null; return;
      }
      if (phase === "RESTORING") {
        event.stopImmediatePropagation();
        if (pinned && current?.key !== pinned.source.key) {
          if (current?.key && current.url) pinned.destination = { key: current.key, index: current.index, url: current.url };
          restore(pinned);
        }
        return;
      }
      const captured = traversal; traversal = null;
      if (!captured || current?.key !== captured.destination.key || registered.current !== captured.registration) return;
      // popstate has already changed the address bar. Stop Next's noncapture
      // restoration, return to the REAL source entry, then ask the customer.
      event.stopImmediatePropagation(); restorationCount = 0; restore(captured);
    };
    native.addEventListener("navigate", observe);
    window.addEventListener("popstate", onPop, { capture: true });
    return () => { disposed = true; ++attempt; restoringRequest.current = null; native.removeEventListener("navigate", observe); window.removeEventListener("popstate", onPop, { capture: true }); };
  }, []);
  return <Context.Provider value={{ register, request }}>{children}</Context.Provider>;
}
export function useNavigationGuardRegistrar() { return useContext(Context)?.register; }
export function useGuardedNavigationRequest() { return useContext(Context)?.request; }

export function GuardedLink({ onNavigate, onClick, replace, scroll, href, ...props }: ComponentProps<typeof NextLink>) {
  const boundary = useContext(Context), router = useRouter(), opener = useRef<HTMLElement | null>(null);
  return <NextLink {...props} href={href} replace={replace} scroll={scroll}
    onClick={event => { opener.current = event.currentTarget; onClick?.(event); }}
    onNavigate={event => {
      let callerPrevented = false;
      onNavigate?.({ preventDefault: () => { callerPrevented = true; event.preventDefault(); } });
      if (callerPrevented) return;
      const path = typeof href === "string" ? href : null;
      if (!boundary || !path) return;
      const intercepted = boundary.request(() => {
        if (replace) router.replace(path, { scroll }); else router.push(path, { scroll });
      }, opener.current);
      if (intercepted) event.preventDefault();
    }} />;
}
