import { beforeEach, describe, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => ({
  authHeaders: vi.fn(() => ({})),
  expireAuth: vi.fn(),
  refreshAuth: vi.fn(),
  useAuth: vi.fn(() => ({ ready: true, authenticated: true })),
}));
vi.mock("./auth", () => auth);
beforeEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
function mockResponse(
  status: number,
  detail: string,
  headers: Record<string, string> = {},
) {
  const response = new Response(JSON.stringify({ detail }), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
  const request = vi.fn(async () => response);
  vi.stubGlobal("fetch", request);
  return request;
}
describe("API authentication and backoff", () => {
  it("expires the session on 401 without replaying a write", async () => {
    const fetch = mockResponse(401, "expired");
    const { send } = await import("./client");
    await expect(send("/api/rooms", "POST", { url: "1" })).rejects.toThrow(
      "expired",
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(auth.expireAuth).toHaveBeenCalledOnce();
  });
  it("refreshes CSRF state but never repeats the rejected write", async () => {
    const fetch = mockResponse(403, "csrf", { "X-BLC-CSRF-Required": "1" });
    const { send } = await import("./client");
    await expect(send("/api/rooms", "POST", {})).rejects.toThrow("csrf");
    expect(auth.refreshAuth).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledOnce();
  });
  it("stops network requests during Retry-After", async () => {
    const fetch = mockResponse(429, "slow down", { "Retry-After": "30" });
    const { api, getPauseUntil } = await import("./client");
    await expect(api("/api/dashboard")).rejects.toThrow("slow down");
    await expect(api("/api/notifications")).rejects.toThrow("暂停");
    expect(fetch).toHaveBeenCalledOnce();
    expect(getPauseUntil()).toBeGreaterThan(Date.now() + 29000);
  });
  it("rejects HTML fallback responses instead of treating them as valid data", async () => {
    const response = new Response("<html/>", {
      headers: { "Content-Type": "text/html" },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response),
    );
    const { api } = await import("./client");
    await expect(api("/api/dashboard")).rejects.toThrow("代理配置");
  });
  it.each([
    ["认证失败", true],
    ["审核员无权访问该管理接口", false],
  ])(
    "distinguishes expired Basic credentials from role denial: %s",
    async (detail, expired) => {
      mockResponse(403, String(detail));
      const { api } = await import("./client");
      await expect(api("/api/dashboard")).rejects.toThrow(String(detail));
      expect(auth.expireAuth).toHaveBeenCalledTimes(expired ? 1 : 0);
    },
  );
});
