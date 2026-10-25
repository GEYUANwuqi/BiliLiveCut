import { createParser } from "eventsource-parser";

let connected = false;
export const eventsConnected = () => connected;

export interface EventCallbacks {
  signal: AbortSignal;
  headers: () => Record<string, string>;
  pausedUntil: () => number;
  refresh: () => void;
  expired: () => void;
}

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, milliseconds);
    signal.addEventListener("abort", finish, { once: true });
  });
}

async function releaseReader(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<void> {
  try {
    await reader.cancel();
  } catch (error) {
    // 已中止或已失败的网络流不再具有可取消的读取；其他清理错误继续报告。
    if (
      !(error instanceof TypeError) &&
      !(error instanceof DOMException && error.name === "AbortError")
    )
      throw error;
  } finally {
    reader.releaseLock();
  }
}

export async function watchEvents(callbacks: EventCallbacks): Promise<void> {
  const { signal, refresh, expired } = callbacks;
  let cursor = "";
  let failures = 0;
  while (!signal.aborted) {
    await wait(Math.max(0, callbacks.pausedUntil() - Date.now()), signal);
    if (signal.aborted) break;
    const attempt = new AbortController();
    const stop = () => attempt.abort();
    signal.addEventListener("abort", stop, { once: true });
    let watchdog = setTimeout(stop, 25000);
    let retry = Math.min(30000, 1000 * 2 ** Math.min(failures, 5));
    let revoked = false;
    let invalid = false;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    refresh();
    try {
      const response = await fetch("/api/events", {
        credentials: "same-origin",
        headers: {
          Accept: "text/event-stream",
          ...callbacks.headers(),
          ...(cursor ? { "Last-Event-ID": cursor } : {}),
        },
        signal: attempt.signal,
      });
      if (response.status === 401) {
        expired();
        return;
      }
      if (response.status === 403) return;
      if (response.status === 429) {
        const value = response.headers.get("Retry-After") || "30";
        const delay = /^\d+$/.test(value)
          ? Number(value) * 1000
          : Date.parse(value) - Date.now();
        retry = Number.isFinite(delay) ? Math.max(1000, delay) : 30000;
      }
      if (
        !response.ok ||
        !response.headers
          .get("content-type")
          ?.startsWith("text/event-stream") ||
        !response.body
      )
        throw new Error("通知连接不可用");
      const parser = createParser({
        maxBufferSize: 65536,
        onError: (error) => {
          invalid = true;
          throw error;
        },
        onRetry: (delay) => {
          retry = Math.min(60000, Math.max(1000, delay));
        },
        onEvent: (event) => {
          if (revoked || signal.aborted) return;
          if (event.event === "auth-expired") {
            revoked = true;
            expired();
            stop();
            return;
          }
          if (
            !["invalidate", "resync"].includes(event.event || "") ||
            !event.id ||
            !/^[a-f0-9]{32}:\d{1,20}$/.test(event.id)
          ) {
            invalid = true;
            throw new Error("未知的通知格式");
          }
          const data: unknown = JSON.parse(event.data);
          if (
            !data ||
            typeof data !== "object" ||
            !("version" in data) ||
            data.version !== 1 ||
            !("topics" in data) ||
            !Array.isArray(data.topics) ||
            !data.topics.every((topic) =>
              ["state", "review", "jobs"].includes(topic),
            )
          ) {
            invalid = true;
            throw new Error("未知的通知版本或范围");
          }
          if (event.event === "resync" || cursor !== event.id) refresh();
          cursor = event.id;
          connected = true;
          failures = 0;
        },
      });
      const decoder = new TextDecoder("utf-8", { fatal: true });
      reader = response.body.getReader();
      while (!attempt.signal.aborted) {
        const chunk = await reader.read();
        if (chunk.done) break;
        clearTimeout(watchdog);
        watchdog = setTimeout(stop, 25000);
        parser.feed(decoder.decode(chunk.value, { stream: true }));
        if (revoked) return;
      }
    } catch (error) {
      if (signal.aborted || revoked) return;
      if (!(error instanceof Error) && !(error instanceof DOMException))
        throw error;
      // 通知不决定业务成功；连接或解析失败时重新查询权威 HTTP 状态。
      if (invalid || error instanceof SyntaxError) cursor = "";
      refresh();
    } finally {
      connected = false;
      clearTimeout(watchdog);
      signal.removeEventListener("abort", stop);
      stop();
      if (reader) await releaseReader(reader);
    }
    failures++;
    await wait(retry, signal);
  }
}
