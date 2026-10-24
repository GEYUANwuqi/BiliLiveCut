import { test, expect, type Page } from "@playwright/test";

type Provider = Record<string, unknown>;

async function fixture(page: Page) {
  let providers: Provider[] = [
    {
      id: "existing-service",
      name: "原有服务",
      base_url: "https://existing.example.invalid/v1",
      model: "existing-model",
      api_key_set: true,
      enabled: true,
      priority: 10,
      web_search_param: "",
      price_input_per_m: 1,
      price_output_per_m: 2,
    },
  ];
  const writes: { path: string; providers: Provider[] }[] = [];
  await page.route("**/*", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/auth/status")
      return route.fulfill({ json: { enabled: false } });
    if (path.startsWith("/api/llm-providers")) {
      if (request.method() !== "GET") {
        const incoming = request.postDataJSON().providers as Provider[];
        writes.push({ path, providers: incoming });
        if (path.endsWith("/test"))
          return route.fulfill({
            json: {
              results: incoming.map((provider) => ({
                name: provider.name,
                ok: true,
                detail: "本地测试响应",
              })),
            },
          });
        providers = incoming.map(({ api_key, clear_api_key, ...provider }) => ({
          ...provider,
          api_key_set:
            !clear_api_key && (!!api_key || provider.id === "existing-service"),
        }));
      }
      return route.fulfill({
        json: { providers, active_count: providers.length },
      });
    }
    if (path.startsWith("/api/")) return route.fulfill({ json: [] });
    return route.continue();
  });
  return writes;
}

test("provider presets create editable drafts without reusing existing credentials", async ({
  page,
}) => {
  const writes = await fixture(page);
  await page.goto("/settings/llm");
  const picker = page.getByLabel("服务商预设", { exact: true });
  for (const name of [
    "DeepSeek",
    "阿里云百炼（Qwen）",
    "火山方舟（豆包）",
    "Kimi（Moonshot）",
    "智谱 GLM",
    "小米 MiMo",
    "硅基流动",
    "MiniMax",
    "百度千帆",
    "腾讯云 TokenHub（混元等）",
    "讯飞星火",
    "魔搭 ModelScope",
    "阶跃星辰 StepFun",
    "无问芯穹",
    "腾讯混元（旧平台）",
    "腾讯云 LKEAP（旧平台）",
  ]) {
    await expect(picker.getByRole("option", { name, exact: true })).toHaveCount(
      1,
    );
  }
  for (const [id, name, url, model] of [
    ["deepseek", "DeepSeek", "https://api.deepseek.com", "deepseek-flash"],
    [
      "bailian",
      "阿里云百炼（Qwen）",
      "https://dashscope.aliyuncs.com/compatible-mode/v1",
      "qwen-plus",
    ],
    [
      "volcengine",
      "火山方舟（豆包）",
      "https://ark.cn-beijing.volces.com/api/v3",
      "doubao-seed-2-1-pro-260915",
    ],
  ]) {
    await picker.selectOption(id);
    await expect(
      page.getByRole("link", { name: `${name}官方接入文档` }),
    ).toHaveAttribute("rel", "noopener noreferrer");
    await page.getByRole("button", { name: "添加服务", exact: true }).click();
    await expect(
      page.getByLabel("服务名称", { exact: true }).last(),
    ).toHaveValue(name);
    await expect(
      page.getByLabel("API 地址", { exact: false }).last(),
    ).toHaveValue(url);
    await expect(
      page.getByLabel("模型名称", { exact: false }).last(),
    ).toHaveValue(model);
    await expect(
      page.getByLabel("API 密钥", { exact: true }).last(),
    ).toHaveValue("");
  }
  expect(writes).toEqual([]);
  await expect(
    page.getByLabel("API 地址", { exact: false }).first(),
  ).toHaveValue("https://existing.example.invalid/v1");
  await page
    .getByLabel("API 地址", { exact: false })
    .last()
    .fill("https://customized.example.invalid/v1");
  await page
    .getByLabel("模型名称", { exact: false })
    .last()
    .fill("my-endpoint");
  await page
    .getByLabel("API 密钥", { exact: true })
    .last()
    .fill("new-test-key");
  await page.getByRole("button", { name: "测试连接", exact: true }).click();
  await expect(page.getByText("本地测试响应")).toHaveCount(4);
  expect(writes.map((write) => write.path)).toEqual([
    "/api/llm-providers/test",
  ]);
  expect(writes[0].providers[0]).toMatchObject({
    id: "existing-service",
    api_key: "",
    clear_api_key: false,
    base_url: "https://existing.example.invalid/v1",
  });
  expect(writes[0].providers.at(-1)).toMatchObject({
    id: "",
    base_url: "https://customized.example.invalid/v1",
    model: "my-endpoint",
    api_key: "new-test-key",
  });
  expect(writes[0].providers[1]).not.toHaveProperty("docsUrl");
  await page.getByRole("button", { name: "保存全部服务", exact: true }).click();
  await expect(page.getByText("服务配置已保存")).toBeVisible();
  expect(writes.map((write) => write.path)).toEqual([
    "/api/llm-providers/test",
    "/api/llm-providers",
  ]);
  await expect(page.getByLabel("API 密钥", { exact: true }).last()).toHaveValue(
    "",
  );
});

test("account-specific models stay blank and custom drafts can be discarded", async ({
  page,
}) => {
  const writes = await fixture(page);
  await page.goto("/settings/llm");
  await page.getByLabel("服务商预设", { exact: true }).selectOption("qianfan");
  await page.getByRole("button", { name: "添加服务", exact: true }).click();
  await expect(
    page.getByLabel("模型名称", { exact: false }).last(),
  ).toHaveValue("");
  await page.getByLabel("服务商预设", { exact: true }).selectOption("custom");
  await page.getByRole("button", { name: "添加服务", exact: true }).click();
  await expect(page.getByLabel("服务名称", { exact: true }).last()).toHaveValue(
    "",
  );
  await expect(
    page.getByLabel("API 地址", { exact: false }).last(),
  ).toHaveValue("");
  await page.getByRole("button", { name: "放弃全部修改", exact: true }).click();
  await expect(page.getByLabel("服务名称", { exact: true })).toHaveCount(1);
  expect(writes).toEqual([]);
});
