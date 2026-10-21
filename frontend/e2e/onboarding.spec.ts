import { test, expect, type Page } from "@playwright/test";

test.use({ storageState: { cookies: [], origins: [] } });
async function fixture(
  page: Page,
  mode: "local" | "basic" | "session" | "reviewer" = "local",
) {
  let authenticated = mode !== "basic";
  let cookie = false;
  let asr = "whisper";
  let providers: Record<string, unknown>[] = [];
  const writes: string[] = [];
  await page.route("**/*", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (!/^\/(api|auth|review\/api)/.test(path)) return route.continue();
    if (request.method() !== "GET") writes.push(path);
    if (path === "/auth/status")
      return route.fulfill({
        json:
          mode === "session" || mode === "reviewer"
            ? {
                enabled: true,
                authenticated: true,
                username: mode === "reviewer" ? "reviewer" : "admin",
                role: mode === "reviewer" ? "reviewer" : "admin",
                csrf_token: "csrf",
              }
            : { enabled: false },
      });
    if (path === "/api/dashboard") {
      if (!authenticated && request.headers().authorization)
        authenticated = true;
      return route.fulfill({
        status: authenticated ? 200 : 401,
        json: authenticated
          ? { rooms: [], live_sources: [], counts: {} }
          : { detail: "需要认证" },
      });
    }
    if (path === "/api/cookie-status")
      return route.fulfill({
        json: { has_cookie: cookie, uid: cookie ? 42 : null },
      });
    if (path === "/api/login/qrcode") {
      if (request.method() === "POST")
        return route.fulfill({ json: { task_id: "intro-qr", status: "scan" } });
      return route.fulfill({ json: { status: "idle", task_id: null } });
    }
    if (path === "/api/login/qrcode/intro-qr") {
      cookie = true;
      return route.fulfill({ json: { task_id: "intro-qr", status: "done" } });
    }
    if (path === "/api/settings/configuration") {
      if (request.method() === "PATCH") {
        asr = request.postDataJSON().values.asr_primary;
        return route.fulfill({ json: { revision: 2 } });
      }
      return route.fulfill({
        json: {
          revision: 1,
          fields: [
            { key: "asr_primary", value: asr },
            { key: "asr_remote_base_url", value: "" },
            { key: "asr_remote_model", value: "" },
            { key: "asr_remote_api_key", secret: true, configured: false },
          ],
        },
      });
    }
    if (path === "/api/llm-providers") {
      if (request.method() === "PUT")
        providers = request.postDataJSON().providers;
      return route.fulfill({
        json: {
          providers: providers.map((provider) => ({
            ...provider,
            api_key: undefined,
            api_key_set: true,
          })),
          active_count: providers.length,
        },
      });
    }
    return route.fulfill({ json: [] });
  });
  return writes;
}

test("welcome blocks the workspace until skipped and can be reopened", async ({
  page,
}) => {
  const writes = await fixture(page);
  await page.goto("/rooms");
  await expect(
    page.getByRole("dialog", { name: "初次见面", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "直播间", exact: true }),
  ).toHaveCount(0);
  expect(writes).toEqual([]);
  await page.getByRole("button", { name: "稍后再说", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "直播间", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "直播间", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "重新打开使用引导" }).click();
  await expect(
    page.getByRole("dialog", { name: "初次见面", exact: true }),
  ).toBeVisible();
});

test("first manual login opens welcome only after authentication", async ({
  page,
}) => {
  await fixture(page, "basic");
  await page.goto("/");
  await expect(
    page.getByRole("dialog", { name: "初次见面", exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("账号", { exact: true }).fill("admin");
  await page
    .getByLabel("密码", { exact: true })
    .fill("browser-fixture-password");
  await page.getByRole("button", { name: "进入工作台", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "初次见面", exact: true }),
  ).toBeVisible();
});

test("restored admin sessions get welcome while reviewers keep their review page", async ({
  page,
}) => {
  await fixture(page, "session");
  await page.goto("/");
  await expect(
    page.getByRole("dialog", { name: "初次见面", exact: true }),
  ).toBeVisible();
  await page.unrouteAll();
  await fixture(page, "reviewer");
  await page.reload();
  await expect(page).toHaveURL(/\/review$/);
  await expect(
    page.getByRole("dialog", { name: "初次见面", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "重新打开使用引导" }),
  ).toHaveCount(0);
});

test("setup saves only explicitly and keeps errors/drafts until corrected", async ({
  page,
}) => {
  const writes = await fixture(page);
  await page.goto("/");
  await page.getByRole("button", { name: "下一步", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "B 站账号", exact: true }),
  ).toBeVisible();
  expect(writes).toEqual([]);
  await page.getByRole("button", { name: "申请二维码", exact: true }).click();
  await expect(
    page.getByText("已保存登录凭据 · UID: 42", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "下一步", exact: true }).click();
  await page
    .getByLabel("转写方式", { exact: true })
    .selectOption("openai_compatible");
  await expect(
    page.getByRole("button", { name: "下一步", exact: true }),
  ).toBeDisabled();
  await page.getByLabel(/转写 API 地址/).fill("https://asr.example.invalid/v1");
  await page.getByLabel(/转写模型 ID/).fill("speech-model");
  await page
    .getByLabel("转写 API 密钥", { exact: true })
    .fill("intro-private-key");
  let fail = true;
  await page.route("**/api/settings/configuration", async (route) => {
    if (route.request().method() === "PATCH" && fail) {
      fail = false;
      return route.fulfill({ status: 400, json: { detail: "配置校验失败" } });
    }
    return route.fallback();
  });
  await page.getByRole("button", { name: "保存转写设置", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("配置校验失败");
  await expect(page.getByLabel("转写 API 密钥", { exact: true })).toHaveValue(
    "intro-private-key",
  );
  await page.getByRole("button", { name: "保存转写设置", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "下一步", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "下一步", exact: true }).click();
  await page.getByRole("button", { name: "添加服务", exact: true }).click();
  await page.getByLabel("服务名称", { exact: true }).fill("我的模型服务");
  await page.getByLabel(/API 地址/).fill("https://llm.example.invalid/v1");
  await page.getByLabel(/模型名称/).fill("chat-model");
  await page
    .getByLabel("API 密钥", { exact: true })
    .fill("another-private-key");
  await page.getByRole("button", { name: "保存全部服务", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "下一步", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "下一步", exact: true }).click();
  await expect(page.getByText("1 个启用服务", { exact: true })).toBeVisible();
  expect(writes).toEqual([
    "/api/login/qrcode",
    "/api/settings/configuration",
    "/api/llm-providers",
  ]);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(
    "private-key",
  );
  await page
    .getByRole("button", { name: "看看工作台怎么用", exact: true })
    .click();
  for (const title of [
    "从一个直播间开始",
    "也可以直接导入录播",
    "沿时间线寻找高光",
    "把最后的判断留给你",
    "在这里找到成品",
    "以后还可以继续调整",
  ]) {
    const bubble = page.getByRole("dialog", { name: title, exact: true });
    await expect(bubble).toBeVisible();
    await expect(bubble).toBeInViewport({ ratio: 1 });
    await bubble
      .getByRole("button", {
        name: title === "以后还可以继续调整" ? "开始使用" : "下一个",
        exact: true,
      })
      .click();
  }
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("setup resumes after reload and tour can exit with Escape", async ({
  page,
}) => {
  await fixture(page);
  await page.goto("/");
  await page.getByRole("button", { name: "下一步", exact: true }).click();
  await page.reload();
  await expect(
    page.getByRole("dialog", { name: "B 站账号", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "上一步", exact: true }).click();
  await page.getByRole("button", { name: "只看功能导览", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "从一个直播间开始", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("configuration conflicts require reading the latest revision before retry", async ({
  page,
}) => {
  await fixture(page);
  await page.addInitScript(() =>
    localStorage.setItem(
      "blc:onboarding:v1:local:%E6%9C%AC%E6%9C%BA%E7%AE%A1%E7%90%86%E5%91%98",
      "setup:2",
    ),
  );
  let revision = 1;
  await page.route("**/api/settings/configuration", async (route) => {
    if (route.request().method() === "PATCH") {
      if (revision === 1) {
        revision = 2;
        return route.fulfill({ status: 409, json: { detail: "配置版本冲突" } });
      }
      expect(route.request().postDataJSON()).toEqual({
        revision: 2,
        values: { asr_primary: "paraformer" },
      });
      return route.fulfill({ json: { revision: 3 } });
    }
    return route.fulfill({
      json: { revision, fields: [{ key: "asr_primary", value: "whisper" }] },
    });
  });
  await page.goto("/");
  await page.getByLabel("转写方式", { exact: true }).selectOption("paraformer");
  await page.getByRole("button", { name: "保存转写设置", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "保存转写设置", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "读取最新配置，保留本步输入", exact: true })
    .click();
  await expect(page.getByLabel("转写方式", { exact: true })).toHaveValue(
    "paraformer",
  );
  await page.getByRole("button", { name: "保存转写设置", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "下一步", exact: true }),
  ).toBeEnabled();
});
