import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { authHeaders, expireAuth, refreshAuth, useAuth } from "./auth";
import { eventsConnected } from "./events";
import type { paths, components } from "./schema";

export type Schemas = components["schemas"];
export type ApiPath = keyof paths;
export type Row = Record<string, unknown>;

export class ApiError extends Error {
  status: number;
  retryAfter: number;
  constructor(message: string, status: number, retryAfter = 0) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

export function allowsAutomaticRefresh(error: unknown): boolean {
  return !(
    error instanceof ApiError &&
    error.status >= 400 &&
    error.status < 500
  );
}

let pauseUntil = 0;
export const getPauseUntil = () => pauseUntil;

function message(data: unknown, status: number) {
  if (data && typeof data === "object" && "detail" in data) {
    const detail = (data as { detail: unknown }).detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail))
      return detail
        .map((item) => {
          const field = Array.isArray(item.loc)
            ? item.loc.slice(1).join(".")
            : "";
          return `${field ? `${field}：` : ""}${item.msg || "字段格式不正确"}`;
        })
        .join("；");
  }
  return status === 429 ? "请求频率过高，请稍后重试" : `请求失败（${status}）`;
}

export async function api<T = unknown>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  if (Date.now() < pauseUntil)
    throw new ApiError(
      "请求已暂停，请等待限流窗口恢复",
      429,
      Math.ceil((pauseUntil - Date.now()) / 1000),
    );
  const method = options.method || "GET";
  const write = !["GET", "HEAD", "OPTIONS"].includes(method);
  const response = await fetch(path, {
    ...options,
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      ...(options.body && typeof options.body === "string"
        ? { "Content-Type": "application/json" }
        : {}),
      ...authHeaders(write),
      ...options.headers,
    },
  });
  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("json") ? await response.json() : undefined;
  if (!response.ok) {
    if (
      response.status === 401 ||
      (response.status === 403 &&
        (data as { detail?: string } | undefined)?.detail === "认证失败")
    )
      expireAuth();
    if (
      response.status === 403 &&
      response.headers.get("X-BLC-CSRF-Required") === "1"
    )
      await refreshAuth();
    let retryAfter = 0;
    if (response.status === 429) {
      const value = response.headers.get("Retry-After");
      const seconds =
        value && /^\d+$/.test(value)
          ? Number(value)
          : value
            ? (Date.parse(value) - Date.now()) / 1000
            : 60;
      retryAfter = Number.isFinite(seconds) ? Math.max(1, seconds) : 60;
      pauseUntil = Date.now() + retryAfter * 1000;
      window.dispatchEvent(
        new CustomEvent("blc:rate-limit", { detail: pauseUntil }),
      );
    }
    throw new ApiError(
      message(data, response.status),
      response.status,
      retryAfter,
    );
  }
  if (response.status !== 204 && !contentType.includes("json"))
    throw new ApiError("服务返回了非 JSON 响应，请检查前后端代理配置", 502);
  return data as T;
}

export const send = <T = unknown>(
  path: string,
  method: string,
  body?: unknown,
) =>
  api<T>(path, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

export function useApi<T = unknown>(
  path: string,
  interval: number | false = 5000,
  enabled = true,
) {
  const auth = useAuth();
  return useQuery<T>({
    queryKey: ["api", path],
    queryFn: ({ signal }) => api<T>(path, { signal }),
    enabled: auth.ready && auth.authenticated && enabled,
    staleTime: 3000,
    refetchInterval: (query) => {
      const error = query.state.error;
      if (!allowsAutomaticRefresh(error)) return false;
      return typeof interval === "number"
        ? Math.min(
            60000,
            Math.max(interval, eventsConnected() ? 30000 : 0) *
              2 ** Math.min(query.state.fetchFailureCount, 4),
          )
        : false;
    },
    refetchIntervalInBackground: false,
    retry: (count, error) =>
      count < 2 && (!(error instanceof ApiError) || error.status >= 500),
  });
}

export function useAction() {
  const query = useQueryClient();
  return useMutation({
    mutationFn: ({
      path,
      method = "POST",
      body,
    }: {
      path: string;
      method?: string;
      body?: unknown;
      success?: string;
    }) => send(path, method, body),
    retry: false,
    onSuccess: (_result, variables) => {
      toast.success(variables.success || "操作已完成");
      void query.invalidateQueries({ queryKey: ["api"] });
    },
    onError: (error) => toast.error(error.message),
  });
}

export function upload(
  path: string,
  file: File,
  progress: (value: number) => void,
  signal: AbortSignal,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (Date.now() < pauseUntil) {
      reject(new ApiError("请求已暂停，请稍后手动继续上传", 429));
      return;
    }
    const request = new XMLHttpRequest();
    request.open("PUT", path);
    request.withCredentials = true;
    request.setRequestHeader("Content-Type", "application/octet-stream");
    Object.entries(authHeaders(true)).forEach(([key, value]) =>
      request.setRequestHeader(key, value),
    );
    request.upload.onprogress = (event) => {
      if (event.lengthComputable)
        progress(Math.round((event.loaded / event.total) * 100));
    };
    const abort = () => request.abort();
    signal.addEventListener("abort", abort, { once: true });
    request.onloadend = () => signal.removeEventListener("abort", abort);
    request.onerror = () =>
      reject(new Error("上传连接中断，已上传的文件保留，可从导入记录继续"));
    request.onabort = () =>
      reject(new DOMException("上传已停止", "AbortError"));
    request.onload = async () => {
      let data: unknown;
      try {
        data = JSON.parse(request.responseText);
      } catch {
        reject(new Error("上传响应无效，请检查导入记录后重试"));
        return;
      }
      if (request.status >= 200 && request.status < 300) resolve(data);
      else {
        if (request.status === 401) expireAuth();
        if (
          request.status === 403 &&
          request.getResponseHeader("X-BLC-CSRF-Required") === "1"
        )
          await refreshAuth();
        if (request.status === 429) {
          const seconds = Number(
            request.getResponseHeader("Retry-After") || 60,
          );
          pauseUntil =
            Date.now() +
            (Number.isFinite(seconds) ? Math.max(1, seconds) : 60) * 1000;
          window.dispatchEvent(
            new CustomEvent("blc:rate-limit", { detail: pauseUntil }),
          );
        }
        reject(new ApiError(message(data, request.status), request.status));
      }
    };
    if (signal.aborted) reject(new DOMException("上传已停止", "AbortError"));
    else request.send(file);
  });
}
