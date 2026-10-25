import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { authHeaders, expireAuth, useAuth } from "@/api/auth";
import { allowsAutomaticRefresh, getPauseUntil } from "@/api/client";
import { watchEvents } from "@/api/events";

export function StateEvents() {
  const auth = useAuth();
  const query = useQueryClient();
  useEffect(() => {
    if (!auth.ready || !auth.authenticated) return;
    const controller = new AbortController();
    let pending: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      if (
        controller.signal.aborted ||
        pending ||
        document.visibilityState === "hidden"
      )
        return;
      pending = setTimeout(() => {
        pending = undefined;
        if (
          !controller.signal.aborted &&
          document.visibilityState !== "hidden" &&
          Date.now() >= getPauseUntil()
        )
          void query.invalidateQueries({
            queryKey: ["api"],
            predicate: (item) => allowsAutomaticRefresh(item.state.error),
          });
      }, 200);
    };
    const stop = () => controller.abort();
    window.addEventListener("blc:identity", stop);
    document.addEventListener("visibilitychange", refresh);
    void watchEvents({
      signal: controller.signal,
      headers: authHeaders,
      pausedUntil: getPauseUntil,
      refresh,
      expired: expireAuth,
    });
    return () => {
      stop();
      clearTimeout(pending);
      window.removeEventListener("blc:identity", stop);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [
    auth.ready,
    auth.authenticated,
    auth.mode,
    auth.username,
    auth.role,
    auth.csrf_token,
    query,
  ]);
  return null;
}
