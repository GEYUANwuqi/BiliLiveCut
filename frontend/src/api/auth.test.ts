import { afterEach, beforeEach, expect, it, vi } from "vitest";

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

function status(csrf: string) {
  return new Response(
    JSON.stringify({
      enabled: true,
      authenticated: true,
      username: "admin",
      role: "admin",
      csrf_token: csrf,
      setup_required: false,
    }),
    { headers: { "Content-Type": "application/json" } },
  );
}

it.each(["logout", "password"])(
  "%s refreshes stale CSRF without replaying the write",
  async (operation) => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(status("old-token"))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ detail: "登录状态已更新" }), {
          status: 403,
          headers: { "X-BLC-CSRF-Required": "1" },
        }),
      )
      .mockResolvedValueOnce(status("new-token"));
    vi.stubGlobal("fetch", fetch);
    const auth = await import("./auth");
    await auth.bootAuth();
    const write = () =>
      operation === "logout"
        ? auth.logout()
        : auth.changePassword("current-password", "replacement-password");
    await expect(write()).rejects.toThrow("登录状态已更新");
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(auth.getAuth().authenticated).toBe(true);
    expect(auth.getAuth().csrf_token).toBe("new-token");
    expect(fetch.mock.calls[1][1].headers["X-BLC-CSRF"]).toBe("old-token");
    fetch.mockResolvedValueOnce(new Response("{}"));
    await write();
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(fetch.mock.calls[3][1].headers["X-BLC-CSRF"]).toBe("new-token");
    expect(auth.getAuth().authenticated).toBe(false);
  },
);
