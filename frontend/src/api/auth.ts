import { useSyncExternalStore } from "react";

export interface AuthState {
  ready: boolean;
  authenticated: boolean;
  mode: "local" | "basic" | "session";
  username: string;
  role: "admin" | "reviewer";
  csrf_token: string;
  setup_required: boolean;
  managed_by_environment: boolean;
  error: string;
}

let state: AuthState = {
  ready: false,
  authenticated: false,
  mode: "local",
  username: "",
  role: "admin",
  csrf_token: "",
  setup_required: false,
  managed_by_environment: false,
  error: "",
};
let basic = "";
let booting: Promise<void> | undefined;
const listeners = new Set<() => void>();
export const getAuth = () => state;
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
export const useAuth = () => useSyncExternalStore(subscribe, getAuth);

function update(next: Partial<AuthState>) {
  state = { ...state, ...next };
  listeners.forEach((listener) => listener());
}

export function authHeaders(write = false): Record<string, string> {
  return {
    ...(basic ? { Authorization: basic } : {}),
    ...(write && state.mode === "session"
      ? { "X-BLC-CSRF": state.csrf_token }
      : {}),
  };
}

async function read(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(
      typeof data.detail === "string"
        ? data.detail
        : `认证失败（${response.status}）`,
    );
  return data;
}

async function restore() {
  try {
    const status = await read(
      await fetch("/auth/status", {
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      }),
    );
    if (status.enabled) {
      const changed =
        state.username &&
        status.authenticated &&
        status.username !== state.username;
      update({ ...status, mode: "session", ready: true, error: "" });
      if (changed)
        window.dispatchEvent(
          new CustomEvent("blc:identity", { detail: { clear: true } }),
        );
    } else {
      const response = await fetch(
        state.role === "reviewer" && basic
          ? "/review/api/queue?limit=1"
          : "/api/dashboard",
        {
          credentials: "same-origin",
          headers: { Accept: "application/json", ...authHeaders() },
        },
      );
      if (response.status === 401)
        update({ ready: true, authenticated: false, mode: "basic", error: "" });
      else {
        await read(response);
        update({
          ready: true,
          authenticated: true,
          mode: basic ? "basic" : "local",
          username: state.username || "本机管理员",
          error: "",
        });
      }
    }
  } catch (error) {
    update({
      ready: true,
      authenticated: false,
      error: error instanceof Error ? error.message : "无法连接后端",
    });
  }
}

export function bootAuth() {
  if (!booting) {
    window.addEventListener("focus", () => {
      if (state.mode === "session") void restore();
    });
    booting = restore();
  }
  return booting;
}

export async function refreshAuth() {
  await restore();
}

export function expireAuth() {
  if (state.authenticated)
    update({
      authenticated: false,
      error: "登录已失效，草稿已保留。请重新登录后手动重试刚才的操作。",
    });
}

export async function login(username: string, password: string, code?: string) {
  const previous = state.username;
  if (state.mode === "session") {
    if (state.setup_required) {
      await read(
        await fetch("/auth/setup", {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({ code: code || "", password }),
        }),
      );
    }
    await read(
      await fetch("/auth/login", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ username, password }),
      }),
    );
    await restore();
    if (!state.authenticated)
      throw new Error(state.error || "登录状态尚未建立，请重试");
  } else {
    const token = `Basic ${btoa(String.fromCharCode(...new TextEncoder().encode(`${username}:${password}`)))}`;
    await read(
      await fetch(
        username === "admin" ? "/api/dashboard" : "/review/api/queue?limit=1",
        {
          credentials: "same-origin",
          headers: { Accept: "application/json", Authorization: token },
        },
      ),
    );
    basic = token;
    await prepareMediaAuth();
    syncMediaAuth();
    update({
      ready: true,
      authenticated: true,
      mode: "basic",
      username,
      role: username === "admin" ? "admin" : "reviewer",
      error: "",
    });
    syncMediaAuth();
  }
  window.dispatchEvent(
    new CustomEvent("blc:identity", {
      detail: { clear: !!previous && previous !== state.username },
    }),
  );
}

async function sessionWrite(path: string, body: Record<string, unknown>) {
  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...authHeaders(true) },
    body: JSON.stringify(body),
  });
  if (
    response.status === 403 &&
    response.headers.get("X-BLC-CSRF-Required") === "1"
  )
    await restore();
  return read(response);
}

export async function logout(everywhere = false) {
  if (state.mode === "session")
    await sessionWrite("/auth/logout", { everywhere });
  basic = "";
  syncMediaAuth();
  update({ authenticated: false, csrf_token: "", username: "", error: "" });
  window.dispatchEvent(
    new CustomEvent("blc:identity", { detail: { clear: true } }),
  );
}

export async function changePassword(
  current_password: string,
  password: string,
) {
  await sessionWrite("/auth/password", { current_password, password });
  basic = "";
  update({
    authenticated: false,
    csrf_token: "",
    error: "密码已更新，请重新登录。",
  });
  window.dispatchEvent(
    new CustomEvent("blc:identity", { detail: { clear: true } }),
  );
}

function syncMediaAuth() {
  navigator.serviceWorker?.controller?.postMessage({
    type: "blc:media-auth",
    authorization: basic,
  });
}

export async function prepareMediaAuth() {
  if (!("serviceWorker" in navigator) || !window.isSecureContext) return false;
  await navigator.serviceWorker.register("/media-auth.js");
  await navigator.serviceWorker.ready;
  if (!navigator.serviceWorker.controller)
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        navigator.serviceWorker.removeEventListener("controllerchange", done);
        resolve();
      };
      const timer = setTimeout(done, 5000);
      navigator.serviceWorker.addEventListener("controllerchange", done);
    });
  navigator.serviceWorker.addEventListener("controllerchange", syncMediaAuth);
  syncMediaAuth();
  return true;
}
