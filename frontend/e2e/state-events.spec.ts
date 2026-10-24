import { test, expect } from "@playwright/test";

for (const notification of ["invalidate", "unknown"]) {
  test(`${notification} notification restores HTTP state and preserves the unsaved configuration`, async ({
    page,
  }) => {
    let release: (() => void) | undefined;
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    let queries = 0;
    let writes = 0;
    let streams = 0;
    let revision = 1;
    const ids: (string | undefined)[] = [];
    await page.route("**/*", async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (!/^\/(api|auth|review\/api|collection\/api)/.test(path))
        return route.continue();
      if (path === "/auth/status")
        return route.fulfill({ json: { enabled: false } });
      if (path === "/api/events") {
        streams++;
        ids.push(request.headers()["last-event-id"]);
        if (streams === 1) {
          await ready;
          return route.fulfill({
            contentType: "text/event-stream",
            body: `id: ${"a".repeat(32)}:1\nevent: ${notification}\ndata: {"version":1,"topics":["state"]}\n\n`,
          });
        }
        return route.fulfill({
          contentType: "text/event-stream",
          body: "event: auth-expired\ndata: {}\n\n",
        });
      }
      if (request.method() !== "GET") writes++;
      if (path === "/api/dashboard")
        return route.fulfill({
          json: { rooms: [], live_sources: [], counts: {} },
        });
      if (path === "/api/jobs") return route.fulfill({ json: { jobs: [] } });
      if (path === "/api/settings/configuration") {
        queries++;
        return route.fulfill({
          json: {
            revision,
            runtime_revision: revision,
            fields: [
              {
                key: "segment_duration_s",
                label: "分段时长",
                group: "recording",
                type: "integer",
                value: revision === 1 ? 60 : 120,
                saved: revision === 1 ? 60 : 120,
                effective: 60,
                default: 60,
                editable: true,
                effect: "next_recording",
                apply_mode: "next_recording",
                effect_description: "下一次录制生效",
              },
            ],
          },
        });
      }
      return route.fulfill({ json: [] });
    });
    try {
      await page.goto("/settings/configuration?q=segment_duration_s");
      const field = page.getByLabel("分段时长", { exact: false });
      await expect(field).toHaveValue("60");
      await field.fill("90");
      await expect.poll(() => streams).toBe(1);
      const before = queries;
      revision = 2;
      release?.();
      await expect
        .poll(() => queries, { timeout: 2500 })
        .toBeGreaterThan(before);
      await expect(field).toHaveValue("90");
      await expect(page.getByRole("dialog")).toContainText(
        "重新登录，继续当前工作",
      );
      await expect(field).toHaveValue("90");
      expect(writes).toBe(0);
      expect(streams).toBe(2);
      expect(ids[1]).toBe(
        notification === "invalidate" ? `${"a".repeat(32)}:1` : undefined,
      );
    } finally {
      release?.();
    }
  });
}
