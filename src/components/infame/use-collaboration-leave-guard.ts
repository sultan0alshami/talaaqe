"use client";
import { useEffect } from "react";
import { useNavigationGuardRegistrar } from "@/components/shells/navigation-guard";
export function useCollaborationLeaveGuard(blocked: boolean, message: string) {
  const register = useNavigationGuardRegistrar();
  useEffect(() => {
    const unregister = register?.({ isBlocked: () => blocked, requestLeave: proceed => { if (!blocked || window.confirm(message)) proceed(); } });
    const before = (event: BeforeUnloadEvent) => { if (blocked) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", before);
    return () => { unregister?.(); window.removeEventListener("beforeunload", before); };
  }, [blocked, message, register]);
}
