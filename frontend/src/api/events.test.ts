import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { eventsConnected, watchEvents, type EventCallbacks } from "./events";

const epoch = "a".repeat(32);
const frame = (kind: string, index: number) =>
  `id: ${epoch}:${index}\nevent: ${kind}\ndata: {"version":1,"topics":["state"]}\n\n`;

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function fixture() {
  const controller = new AbortController();
  const callbacks: EventCallbacks = {
    signal: controller.signal,
    headers: () => ({ Authorization: "Basic private-header" }),
    pausedUntil: () => 0,
    refresh: vi.fn(),
    expired: vi.fn(),
  };
  return { controller, callbacks };
}

function response(chunks: string[]) {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(stream) {
        for (const chunk of chunks)
          stream.enqueue(new TextEncoder().encode(chunk));
        stream.close();
      },
    }),
    { headers: { "Content-Type": "text/event-stream" } },
  );
}

it("parses split frames, deduplicates notifications and resumes with a header", async () => {
  const { callbacks } = fixture();
  const content =
    frame("resync", 0) +
    frame("invalidate", 1) +
    frame("invalidate", 1) +
    frame("resync", 1);
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(response([content.slice(0, 17), content.slice(17)]))
    .mockResolvedValueOnce(new Response("", { status: 401 }));
  vi.stubGlobal("fetch", fetch);
  const task = watchEvents(callbacks);
  await vi.advanceTimersByTimeAsync(1100);
  await task;
  expect(callbacks.refresh).toHaveBeenCalledTimes(5);
  expect(fetch.mock.calls[1][0]).toBe("/api/events");
  expect(fetch.mock.calls[1][1].headers).toMatchObject({
    "Last-Event-ID": `${epoch}:1`,
    Authorization: "Basic private-header",
  });
  expect(
    fetch.mock.calls.every(([, options]) => !options.body && !options.method),
  ).toBe(true);
  expect(callbacks.expired).toHaveBeenCalledOnce();
  expect(eventsConnected()).toBe(false);
});

it.each([
  "event: unknown\ndata: {}\n\n",
  'event: invalidate\ndata: {"bad"\n\n',
  "data: " + "x".repeat(70000),
])("invalid or oversized messages recover through HTTP", async (invalid) => {
  const { callbacks } = fixture();
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(response([frame("resync", 0), invalid]))
    .mockResolvedValueOnce(new Response("", { status: 401 }));
  vi.stubGlobal("fetch", fetch);
  const task = watchEvents(callbacks);
  await vi.advanceTimersByTimeAsync(1100);
  await task;
  expect(callbacks.refresh).toHaveBeenCalledTimes(4);
  expect(fetch.mock.calls[1][1].headers).not.toHaveProperty("Last-Event-ID");
});

it("honors Retry-After and cancels retry timers on logout", async () => {
  const { callbacks, controller } = fixture();
  const fetch = vi
    .fn()
    .mockResolvedValue(
      new Response("", { status: 429, headers: { "Retry-After": "30" } }),
    );
  vi.stubGlobal("fetch", fetch);
  const task = watchEvents(callbacks);
  await vi.advanceTimersByTimeAsync(29000);
  expect(fetch).toHaveBeenCalledOnce();
  controller.abort();
  await task;
  await vi.advanceTimersByTimeAsync(10000);
  expect(fetch).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it("server revocation ends the subscription without retrying or replaying mutations", async () => {
  const { callbacks } = fixture();
  const fetch = vi
    .fn()
    .mockResolvedValue(
      response([
        frame("resync", 0),
        "event: auth-expired\ndata: {}\n\n" + frame("invalidate", 1),
      ]),
    );
  vi.stubGlobal("fetch", fetch);
  const task = watchEvents(callbacks);
  await vi.advanceTimersByTimeAsync(1);
  await task;
  expect(callbacks.expired).toHaveBeenCalledOnce();
  expect(fetch).toHaveBeenCalledOnce();
  expect(callbacks.refresh).toHaveBeenCalledTimes(2);
  expect(eventsConnected()).toBe(false);
});

it("stalled fetches are aborted and API rate limits delay subscription requests", async () => {
  const { callbacks, controller } = fixture();
  const pause = Date.now() + 5000;
  callbacks.pausedUntil = () => pause;
  const fetch = vi.fn(
    (_path: string, options: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        options.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("aborted", "AbortError")),
          { once: true },
        );
      }),
  );
  vi.stubGlobal("fetch", fetch);
  const task = watchEvents(callbacks);
  await vi.advanceTimersByTimeAsync(4999);
  expect(fetch).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(25002);
  expect(fetch).toHaveBeenCalledOnce();
  expect(fetch.mock.calls[0][1].signal?.aborted).toBe(true);
  expect(callbacks.refresh).toHaveBeenCalledTimes(2);
  controller.abort();
  await task;
  expect(vi.getTimerCount()).toBe(0);
});

it.each([
  new TypeError("closed"),
  new DOMException("aborted", "AbortError"),
  new Error("close-failed"),
])(
  "releases the stream lock and only tolerates known network cleanup errors: %s",
  async (error) => {
    const { callbacks } = fixture();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode("event: auth-expired\ndata: {}\n\n"),
        );
      },
      cancel() {
        throw error;
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(stream, {
          headers: { "Content-Type": "text/event-stream" },
        }),
      ),
    );
    const task = watchEvents(callbacks);
    const assertion =
      error.message === "close-failed"
        ? expect(task).rejects.toThrow("close-failed")
        : expect(task).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    await assertion;
    expect(stream.locked).toBe(false);
    expect(eventsConnected()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  },
);
