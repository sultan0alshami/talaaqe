// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useEffect, type ComponentProps } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type NextLink from "next/link";
import {
  GuardedLink, NavigationGuardProvider, useGuardedNavigationRequest,
  useNavigationGuardRegistrar, type NavigationGuard,
} from "@/components/shells/navigation-guard";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("next/link", () => ({
  default: function FrameworkLink({ href, onClick, onNavigate, replace, scroll, children, ...props }: ComponentProps<typeof NextLink>) {
    const path = typeof href === "string" ? href : href.pathname ?? "";
    return <a {...props} href={path} onClick={event => {
      onClick?.(event);
      if (event.defaultPrevented) return;
      event.preventDefault();
      let prevented = false;
      onNavigate?.({ preventDefault: () => { prevented = true; } });
      if (!prevented) (replace ? router.replace : router.push)(path, { scroll });
    }}>{children}</a>;
  },
}));

// These are framework-seam unit witnesses. The separate real-browser case builds
// its history through actual Next Links; this transport neither creates history
// entries nor claims native-browser acceptance, consent, or provider readiness.
type EntrySnapshot = Readonly<{ key: string; index: number; url: string }>;
type RouterState = Readonly<{ __NA: true; __PRIVATE_NEXTJS_INTERNALS_TREE: Readonly<{ tree: readonly string[]; renderedSearch: string }> }>;
function deferred() {
  let resolve!: () => void, reject!: (reason: unknown) => void;
  return { promise: new Promise<void>((yes, no) => { resolve = yes; reject = no; }), resolve: () => resolve(), reject: (reason: unknown) => reject(reason) };
}
function routerState(route: string): RouterState {
  return Object.freeze({ __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: Object.freeze({ tree: Object.freeze([route]), renderedSearch: "" }) });
}
class FrameworkNavigation extends EventTarget {
  currentEntry: EntrySnapshot;
  readonly calls: { key: string; completion: ReturnType<typeof deferred> }[] = [];
  readonly observedStates: RouterState[] = [];
  readonly traverseTo = vi.fn((key: string) => {
    const completion = deferred(); this.calls.push({ key, completion }); return { finished: completion.promise };
  });
  constructor(source: EntrySnapshot) { super(); this.currentEntry = source; }
  commit(destination: EntrySnapshot, state: RouterState) {
    const event = new Event("navigate");
    Object.defineProperties(event, { navigationType: { value: "traverse" }, destination: { value: { ...destination, sameDocument: true } } });
    this.dispatchEvent(event); this.currentEntry = destination; this.observedStates.push(state);
    window.dispatchEvent(new PopStateEvent("popstate", { state }));
  }
}
function recorder() {
  const continuations: (() => void)[] = [];
  const guard: NavigationGuard = { isBlocked: () => true, requestLeave: vi.fn((proceed: () => void) => { continuations.push(proceed); }) };
  return { guard, continuations };
}
function Register({ guard }: { guard: NavigationGuard }) {
  const register = useNavigationGuardRegistrar();
  useEffect(() => register?.(guard), [guard, register]);
  return null;
}
function Action({ proceed }: { proceed: () => void }) {
  const request = useGuardedNavigationRequest();
  return <button onClick={event => { if (!request?.(proceed, event.currentTarget)) proceed(); }}>Sign out</button>;
}
function fixture() {
  const source: EntrySnapshot = Object.freeze({ key: "editor-entry", index: 2, url: location.href });
  const previous: EntrySnapshot = Object.freeze({ key: "campaign-list-entry", index: 1, url: new URL("/brand/campaigns", location.href).href });
  const earlier: EntrySnapshot = Object.freeze({ key: "brand-context-entry", index: 0, url: new URL("/brand/context", location.href).href });
  const sourceState = routerState("campaign-editor"), previousState = routerState("campaign-list"), earlierState = routerState("brand-context");
  const native = new FrameworkNavigation(source); vi.stubGlobal("navigation", native);
  const push = vi.spyOn(history, "pushState"), replace = vi.spyOn(history, "replaceState");
  const nextRestore = vi.fn(); window.addEventListener("popstate", nextRestore);
  const capture = recorder();
  render(<NavigationGuardProvider><Register guard={capture.guard} /><GuardedLink href="/brand/context">Brand context</GuardedLink></NavigationGuardProvider>);
  return { source, previous, earlier, sourceState, previousState, earlierState, native, push, replace, nextRestore, capture,
    dispose: () => window.removeEventListener("popstate", nextRestore) };
}
beforeEach(() => { router.push.mockReset(); router.replace.mockReset(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("consumes each confirmed shared continuation once for both a Link and a sign-out action", () => {
  const capture = recorder(), signOut = vi.fn();
  render(<NavigationGuardProvider><Register guard={capture.guard} /><GuardedLink href="/brand/context">Brand context</GuardedLink><Action proceed={signOut} /></NavigationGuardProvider>);
  fireEvent.click(screen.getByRole("link", { name: "Brand context" }));
  expect(capture.continuations).toHaveLength(1); expect(router.push).not.toHaveBeenCalled();
  act(() => { capture.continuations[0]!(); capture.continuations[0]!(); });
  fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
  expect(capture.continuations).toHaveLength(2); expect(signOut).not.toHaveBeenCalled();
  act(() => { capture.continuations[1]!(); capture.continuations[1]!(); });
  expect(router.push).toHaveBeenCalledExactlyOnceWith("/brand/context", { scroll: undefined });
  expect(signOut).toHaveBeenCalledOnce();
});

it("honors the caller's onNavigate prevention before consulting the leaf or router", () => {
  const capture = recorder(), prevent = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
  render(<NavigationGuardProvider><Register guard={capture.guard} /><GuardedLink href="/brand/context" onNavigate={prevent}>Brand context</GuardedLink></NavigationGuardProvider>);
  fireEvent.click(screen.getByRole("link", { name: "Brand context" }));
  expect(prevent).toHaveBeenCalledOnce(); expect(capture.guard.requestLeave).not.toHaveBeenCalled();
  expect(router.push).not.toHaveBeenCalled(); expect(router.replace).not.toHaveBeenCalled();
});

it("pins the original editor entry through a second Back that aborts the first restoration", async () => {
  const f = fixture();
  try {
    act(() => f.native.commit(f.previous, f.previousState));
    expect(f.native.calls).toHaveLength(1); expect(f.native.calls[0]!.key).toBe(f.source.key);
    expect(f.nextRestore).not.toHaveBeenCalled(); expect(f.capture.guard.requestLeave).not.toHaveBeenCalled();
    await act(async () => {
      f.native.commit(f.earlier, f.earlierState);
      f.native.calls[0]!.completion.reject(new DOMException("Superseded by another traversal", "AbortError"));
    });
    expect(f.native.calls).toHaveLength(2); expect(f.native.calls[1]!.key).toBe(f.source.key);
    expect(f.nextRestore).not.toHaveBeenCalled(); expect(f.capture.guard.requestLeave).not.toHaveBeenCalled();
    await act(async () => { f.native.commit(f.source, f.sourceState); f.native.calls[1]!.completion.resolve(); });
    expect(f.native.currentEntry).toBe(f.source); expect(f.capture.guard.requestLeave).toHaveBeenCalledOnce();
    expect(f.native.observedStates).toEqual([f.previousState, f.earlierState, f.sourceState]);
    expect(f.sourceState.__PRIVATE_NEXTJS_INTERNALS_TREE.tree).toEqual(["campaign-editor"]);
    expect(f.push).not.toHaveBeenCalled(); expect(f.replace).not.toHaveBeenCalled();
  } finally { f.dispose(); }
});

it("defers a newer shell Link until restoration and prevents the older Back attempt from replacing it", async () => {
  const f = fixture();
  try {
    act(() => f.native.commit(f.previous, f.previousState));
    fireEvent.click(screen.getByRole("link", { name: "Brand context" }));
    // The editor URL must be restored before asking about the newer Link. Its
    // continuation owns this request; the earlier Back must never replace it.
    expect(f.capture.guard.requestLeave).not.toHaveBeenCalled(); expect(router.push).not.toHaveBeenCalled();
    await act(async () => { f.native.commit(f.source, f.sourceState); f.native.calls[0]!.completion.resolve(); });
    expect(f.capture.continuations).toHaveLength(1); expect(f.native.currentEntry).toBe(f.source);
    act(() => { f.capture.continuations[0]!(); f.capture.continuations[0]!(); });
    expect(router.push).toHaveBeenCalledExactlyOnceWith("/brand/context", { scroll: undefined });
    expect(f.native.calls).toHaveLength(1); expect(f.nextRestore).not.toHaveBeenCalled();
    expect(f.push).not.toHaveBeenCalled(); expect(f.replace).not.toHaveBeenCalled();
  } finally { f.dispose(); }
});

it("contains a synchronous InvalidStateError from source traversal and releases the shared request seam", () => {
  const f = fixture(), uncaught: unknown[] = [];
  const observeError = (event: ErrorEvent) => {
    // Observe the event-handler failure without allowing this negative witness
    // to become a runner-level uncaught error in addition to its assertion.
    uncaught.push(event.error); event.preventDefault(); event.stopImmediatePropagation();
  };
  window.addEventListener("error", observeError, { capture: true });
  f.native.traverseTo.mockImplementation(() => { throw new DOMException("Source entry is no longer available", "InvalidStateError"); });
  try {
    act(() => f.native.commit(f.previous, f.previousState));
    fireEvent.click(screen.getByRole("link", { name: "Brand context" }));
    expect(uncaught).toEqual([]); expect(f.native.traverseTo).toHaveBeenCalledOnce();
    expect(f.capture.guard.requestLeave).toHaveBeenCalledOnce(); expect(router.push).not.toHaveBeenCalled();
    expect(f.native.observedStates).toEqual([f.previousState]);
    expect(f.push).not.toHaveBeenCalled(); expect(f.replace).not.toHaveBeenCalled();
  } finally { window.removeEventListener("error", observeError, { capture: true }); f.dispose(); }
});

it("stops retrying a disposed source key after a rejected InvalidStateError and releases queued state", async () => {
  const f = fixture(), stopped = deferred();
  let attempts = 0;
  f.native.traverseTo.mockImplementation(() => {
    attempts++;
    // A broken implementation can recursively retry rejected promises forever.
    // After three identical hard failures, hold the fourth transport attempt so
    // this RED is finite; the bounded observed call count exposes that loop.
    return { finished: attempts <= 3
      ? Promise.reject(new DOMException("Source key was disposed", "InvalidStateError"))
      : stopped.promise };
  });
  try {
    await act(async () => {
      f.native.commit(f.previous, f.previousState);
      fireEvent.click(screen.getByRole("link", { name: "Brand context" }));
      expect(f.capture.guard.requestLeave).not.toHaveBeenCalled();
      for (let tick = 0; tick < 16; tick++) await Promise.resolve();
    });
    fireEvent.click(screen.getByRole("link", { name: "Brand context" }));
    expect(attempts).toBe(1); expect(f.capture.guard.requestLeave).toHaveBeenCalledOnce();
    expect(router.push).not.toHaveBeenCalled(); expect(f.native.observedStates).toEqual([f.previousState]);
    expect(f.sourceState.__PRIVATE_NEXTJS_INTERNALS_TREE.tree).toEqual(["campaign-editor"]);
    expect(f.push).not.toHaveBeenCalled(); expect(f.replace).not.toHaveBeenCalled();
  } finally { f.dispose(); }
});
