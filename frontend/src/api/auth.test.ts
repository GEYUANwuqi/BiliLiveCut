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

it("answers only its current same-origin worker and clears media access on expiry and logout", async () => {
  const controller = {};
  let receive!: (event: MessageEvent) => void;
  vi.stubGlobal("navigator", {
    serviceWorker: {
      controller,
      addEventListener: (
        _name: string,
        listener: (event: MessageEvent) => void,
      ) => {
        receive = listener;
      },
    },
  });
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ enabled: false })))
    .mockResolvedValueOnce(new Response("{}", { status: 401 }))
    .mockImplementation(async () => new Response("{}"));
  vi.stubGlobal("fetch", fetch);
  const auth = await import("./auth");
  await auth.bootAuth();
  await auth.login("admin", "test-password");
  const port = { postMessage: vi.fn(), close: vi.fn() };
  const event = {
    origin: window.location.origin,
    source: controller,
    data: { type: "blc:media-auth-request" },
    ports: [port],
  };
  for (const change of [
    { origin: "https://other.test" },
    { origin: "null" },
    { source: {} },
    { source: null },
    { data: { type: "other" } },
    { ports: [] },
    { ports: [port, port] },
  ])
    receive({ ...event, ...change } as unknown as MessageEvent);
  expect(port.postMessage).not.toHaveBeenCalled();
  receive(event as unknown as MessageEvent);
  expect(port.postMessage).toHaveBeenLastCalledWith({
    authorization: auth.authHeaders().Authorization,
  });
  expect(port.close).toHaveBeenCalledOnce();
  auth.expireAuth();
  receive(event as unknown as MessageEvent);
  expect(port.postMessage).toHaveBeenLastCalledWith({ authorization: "" });
  await auth.login("admin", "test-password");
  await auth.logout();
  receive(event as unknown as MessageEvent);
  expect(port.postMessage).toHaveBeenLastCalledWith({ authorization: "" });
});
