"use client";
import { useSyncExternalStore } from "react";

const subscribe = () => () => {};
const browserReady = () => true;
const serverReady = () => false;

// The server and first hydration render stay inert. The subsequent browser
// render installs the handlers and reads useDealRequest's browser journal
// snapshot in that same render before any controls become interactive.
// There is no effect-driven state update, timer, storage mutation or replay.
export function useDealHydrationReady(): boolean {
  return useSyncExternalStore(subscribe, browserReady, serverReady);
}
