import { test, expect } from "@playwright/test";

test("saved startup options show their current value and restart requirement", async ({
  page,
}) => {
  let saved = false;
  let submitted: unknown;
  await page.route("**/*", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (!/^\/(api|auth|review\/api|collection\/api)/.test(path)) {
      await route.continue();
      return;
    }
    if (path === "/auth/status")
      return route.fulfill({ json: { enabled: false } });
    if (path === "/api/jobs") return route.fulfill({ json: { jobs: [] } });
    if (path === "/api/settings/configuration") {
      if (route.request().method() === "PATCH") {
        submitted = route.request().postDataJSON();
        saved = true;
      }
      return route.fulfill({
        json: {
          revision: saved ? 8 : 7,
          runtime_revision: saved ? 8 : 7,
          fields: [
            {
              key: "asr_preload_on_start",
              label: "启动预加载",
              group: "asr",
              type: "boolean",
              value: saved,
              saved,
              effective: false,
              default: false,
              editable: true,
              effect: "restart",
              apply_mode: "restart",
              pending_restart: saved,
              effect_description:
                "重启应用进程后生效；当前进程继续使用启动时的值。",
            },
          ],
        },
      });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto("/settings/configuration?q=asr_preload_on_start");
  await page.getByRole("switch", { name: "启动预加载" }).click();
  await page.getByRole("button", { name: /保存/ }).click();
  await expect(
    page.getByText("配置已保存：1 项等待重启", { exact: true }),
  ).toBeVisible();
  expect(submitted).toEqual({
    revision: 7,
    values: { asr_preload_on_start: true },
    clear: [],
    reset: [],
  });
  await expect(
    page.getByText("已保存，等待重启。当前进程值：关闭", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByRole("switch", { name: "启动预加载" })).toBeChecked();
  await expect(
    page.getByText("已保存，等待重启。当前进程值：关闭", { exact: true }),
  ).toBeVisible();
});
