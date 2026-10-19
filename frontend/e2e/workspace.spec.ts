import { test, expect, type Page } from "@playwright/test";
async function mock(page: Page) {
  await page.route("**/*", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (!/^\/(api|auth|review\/api|collection\/api)/.test(path)) {
      await route.continue();
      return;
    }
    let data: unknown = [];
    if (path === "/auth/status") data = { enabled: false };
    if (path === "/api/dashboard")
      data = {
        rooms: [],
        live_sources: [],
        counts: { candidates: 0, clips: 0, active_sessions: 0 },
      };
    if (path === "/api/recording-imports")
      data = {
        imports: [],
        max_video_bytes: 53687091200,
        max_comment_bytes: 33554432,
      };
    if (path === "/api/jobs") data = { jobs: [] };
    if (path === "/api/topics") data = { topics: [] };
    if (path === "/api/plugins") data = { plugins: [] };
    if (path === "/api/llm-providers")
      data = { providers: [], active_count: 0 };
    if (path === "/api/cookie-status") data = { has_cookie: false };
    if (path === "/api/login/qrcode") data = { status: "idle", task_id: null };
    if (path === "/review/api/queue")
      data = {
        items: [],
        counts: { pending: 0, claimed: 0, reviewed: 0 },
        total: 0,
        has_more: false,
      };
    if (path === "/api/settings/configuration")
      data = {
        revision: "1",
        fields: [
          {
            key: "segment_duration_s",
            label: "分段时长",
            description: "常用设置",
            group: "recording",
            value: 60,
            type: "integer",
            editable: true,
            default: 60,
            effect: "next_recording",
          },
          {
            key: "advanced_one",
            label: "高级设置示例",
            group: "recording",
            value: "test",
            type: "string",
            editable: true,
            default: "test",
          },
        ],
      };
    await route.fulfill({ json: data });
  });
}
test.beforeEach(async ({ page }) => mock(page));

for (const path of ["/rooms", "/"]) {
  test(`room deletion requires confirmation and refreshes the list on ${path}`, async ({
    page,
  }) => {
    let removed = false;
    let deletions = 0;
    await page.route("**/api/dashboard", (route) =>
      route.fulfill({
        json: {
          rooms: removed
            ? []
            : [{ id: 88, room_id: 123, uploader_name: "待删除的主播" }],
          counts: {},
        },
      }),
    );
    await page.route("**/api/rooms/88", (route) => {
      expect(route.request().method()).toBe("DELETE");
      deletions++;
      removed = true;
      return route.fulfill({ json: { status: "deleted" } });
    });
    await page.goto(path);
    await page.getByRole("button", { name: "删除", exact: true }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText("已有录制、弹幕和切片仍会保留");
    await page.getByRole("button", { name: "取消", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(deletions).toBe(0);
    await expect(
      page.getByRole("heading", { name: "待删除的主播" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "删除", exact: true }).click();
    await page.getByRole("button", { name: "确认删除", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "待删除的主播" }),
    ).toHaveCount(0);
    await expect(dialog).toHaveCount(0);
    expect(deletions).toBe(1);
  });
}

test("room deletion shows recording conflicts and permits a manual retry", async ({
  page,
}) => {
  let attempts = 0;
  await page.route("**/api/dashboard", (route) =>
    route.fulfill({
      json: {
        rooms: [{ id: 88, room_id: 123, uploader_name: "状态变化的主播" }],
        counts: {},
      },
    }),
  );
  await page.route("**/api/rooms/88", (route) => {
    attempts++;
    return attempts === 1
      ? route.fulfill({
          status: 409,
          json: { detail: "直播间正在录制或收尾，请先停止录制再删除。" },
        })
      : route.fulfill({ json: { status: "deleted" } });
  });
  await page.goto("/rooms");
  await page.getByRole("button", { name: "删除", exact: true }).click();
  await page.getByRole("button", { name: "确认删除", exact: true }).click();
  await expect(page.getByRole("alertdialog").getByRole("alert")).toContainText(
    "请先停止录制再删除",
  );
  expect(attempts).toBe(1);
  await page.getByRole("button", { name: "确认删除", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  expect(attempts).toBe(2);
});

test("recording rooms explain why deletion is unavailable", async ({
  page,
}) => {
  await page.route("**/api/dashboard", (route) =>
    route.fulfill({
      json: {
        rooms: [{ id: 88, running: true, uploader_name: "正在录制的主播" }],
        counts: {},
      },
    }),
  );
  await page.goto("/rooms");
  await expect(
    page.getByRole("button", { name: "删除", exact: true }),
  ).toBeDisabled();
  await expect(page.getByText("停止录制后可删除")).toBeVisible();
});

test("workspace renders and opens every navigation page without errors", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "工作台概览", exact: true }),
  ).toBeVisible();
  for (const [path, title] of [
    ["/rooms", "直播间"],
    ["/imports", "录播分析"],
    ["/recording", "录制状态"],
    ["/schedules", "录制预约"],
    ["/transcripts", "语音转写"],
    ["/danmaku", "弹幕热度"],
    ["/sessions", "场次时间线"],
    ["/review", "人工审片"],
    ["/topics", "主题与合集"],
    ["/clips", "成品切片"],
    ["/uploads", "上传与发布"],
    ["/trends", "网感资料库"],
    ["/tasks", "任务队列"],
    ["/analytics", "数据分析"],
    ["/monitor", "运行状态"],
    ["/logs", "错误日志"],
    ["/settings", "设置中心"],
    ["/settings/llm", "大模型服务"],
    ["/settings/login", "Bilibili 账号"],
    ["/settings/plugins", "插件中心"],
    ["/settings/subtitles", "字幕模板"],
    ["/settings/intros", "片头与片尾"],
  ]) {
    await page.goto(path);
    await expect(
      page.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    await expect(page.getByText("页面暂时无法显示")).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});
test("empty imports settle and configuration counts follow advanced visibility", async ({
  page,
}) => {
  await page.goto("/imports");
  await expect(page.getByText("正在读取导入记录")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /还没有导入/ })).toBeVisible();
  await page.goto("/settings/configuration");
  await expect(page.getByText("显示 1 / 1 项常用配置")).toBeVisible();
  await page.getByRole("switch", { name: "显示高级设置" }).click();
  await expect(page.getByText("显示 2 / 2 项配置")).toBeVisible();
});
test("editing and switching routes keeps the draft without a browser leave warning", async ({
  page,
}) => {
  let dialogs = 0;
  page.on("dialog", async (dialog) => {
    dialogs++;
    await dialog.dismiss();
  });
  await page.goto("/settings/configuration");
  const field = page.getByLabel("分段时长", { exact: false });
  await field.fill("120");
  if (test.info().project.name === "mobile")
    await page.getByRole("button", { name: "展开导航" }).click();
  await page
    .getByRole("link", { name: "录播分析", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "录播分析", exact: true }),
  ).toBeVisible();
  if (test.info().project.name === "mobile")
    await page.getByRole("button", { name: "展开导航" }).click();
  await page
    .getByRole("link", { name: "设置中心", exact: true })
    .first()
    .click();
  await page.getByRole("link", { name: /全部参数/ }).click();
  await expect(field).toHaveValue("120");
  expect(dialogs).toBe(0);
});
test("empty optional ASR settings do not block saving other configuration", async ({
  page,
}) => {
  await page.route("**/api/settings/configuration", async (route) => {
    if (route.request().method() === "PATCH") {
      expect(route.request().postDataJSON()).toEqual({
        revision: "optional-settings",
        values: { segment_duration_s: 120 },
        clear: [],
        reset: [],
      });
      await route.fulfill({ json: {} });
      return;
    }
    await route.fulfill({
      json: {
        revision: "optional-settings",
        fields: [
          {
            key: "segment_duration_s",
            label: "分段时长",
            group: "recording",
            type: "integer",
            value: 60,
          },
          {
            key: "asr_remote_base_url",
            label: "远程转写地址",
            group: "asr",
            type: "string",
            value: "",
          },
        ],
      },
    });
  });
  await page.goto("/settings/configuration");
  await page.getByLabel("分段时长", { exact: false }).fill("120");
  const saved = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/settings/configuration" &&
      response.request().method() === "PATCH",
  );
  await page.getByRole("button", { name: "保存修改", exact: true }).click();
  expect((await saved).status()).toBe(200);
});
test("401 pauses reads and retains settings under the reauthentication dialog", async ({
  page,
}) => {
  await page.goto("/settings/configuration");
  await page.getByLabel("分段时长", { exact: false }).fill("90");
  await page.route("**/api/settings/configuration", (route) =>
    route.fulfill({ status: 401, json: { detail: "expired" } }),
  );
  await page.getByRole("button", { name: "读取最新配置" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByText("登录已失效", { exact: false }).first(),
  ).toBeVisible();
});

test("historical session selector sends the real session_id", async ({
  page,
}) => {
  await page.route("**/api/sessions/history", (route) =>
    route.fulfill({
      json: [
        {
          session_id: 41,
          status: "stopped",
          started_at: "2026-10-16T00:00:00Z",
          transcript_count: 1,
          danmaku_count: 0,
        },
        {
          session_id: 7,
          status: "stopped",
          started_at: "2026-10-15T00:00:00Z",
          transcript_count: 1,
          danmaku_count: 0,
        },
      ],
    }),
  );
  await page.goto("/transcripts");
  const request = page.waitForRequest(
    (request) =>
      new URL(request.url()).pathname === "/api/transcripts" &&
      new URL(request.url()).searchParams.get("session_id") === "41",
  );
  await page.getByRole("combobox", { name: "筛选录制场次" }).selectOption("41");
  await request;
  await expect(page).toHaveURL(/session=41/);
});

test("queue selection uses candidate ids and reports partial failure", async ({
  page,
}) => {
  await page.route("**/review/api/queue?**", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: 17,
            session_id: 41,
            status: "pending",
            review_status: "pending",
            reason: "值得审核的高光",
            score: 0.8,
            start_ts: "2026-10-16T00:00:00Z",
            end_ts: "2026-10-16T00:00:30Z",
            claim: { active: false },
          },
        ],
        counts: { pending: 1, claimed: 0, reviewed: 0 },
        total: 1,
        has_more: false,
      },
    }),
  );
  await page.route("**/api/candidates/batch", async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      action: "approve",
      candidate_ids: [17],
    });
    await route.fulfill({
      json: {
        success: [],
        failed: [{ candidate_id: 17, error: "媒体尚未准备好" }],
      },
    });
  });
  await page.goto("/review");
  await page.getByRole("checkbox", { name: "选择候选 17" }).click();
  await page.getByRole("button", { name: "通过并渲染", exact: true }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "确认操作" })
    .click();
  await expect(page.getByText("#17 媒体尚未准备好")).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: "选择候选 17" }),
  ).toBeChecked();
});

test("a missing QR task stops polling and keeps recovery explicit", async ({
  page,
}) => {
  let polls = 0;
  let starts = 0;
  await page.route("**/api/login/qrcode", async (route) => {
    if (route.request().method() === "POST") starts++;
    await route.fulfill({ json: { task_id: "qr-fixture", status: "scan" } });
  });
  await page.route("**/api/login/qrcode/qr-fixture", async (route) => {
    polls++;
    await route.fulfill({ status: 404, json: { detail: "登录任务不存在" } });
  });
  await page.goto("/settings/login");
  await expect(page.getByRole("button", { name: "重试读取" })).toBeVisible();
  await page.waitForTimeout(4500);
  expect(polls).toBe(1);
  expect(starts).toBe(0);
});

test("plugin settings preserve input kinds and send valid typed values", async ({
  page,
}) => {
  const fields = [
    {
      key: "token",
      label: "访问密钥",
      kind: "password",
      value: "",
      configured: true,
      required: true,
      choices: [],
    },
    {
      key: "title",
      label: "显示名称",
      kind: "text",
      value: "演示",
      choices: [],
    },
    {
      key: "weight",
      label: "权重",
      kind: "number",
      value: 0.5,
      minimum: 0,
      maximum: 1,
      choices: [],
    },
    {
      key: "mode",
      label: "运行方式",
      kind: "select",
      value: "fast",
      choices: ["fast", "accurate"],
    },
    {
      key: "active",
      label: "启用分析",
      kind: "boolean",
      value: true,
      choices: [],
    },
  ];
  await page.route("**/api/plugins/demo/settings", async (route) => {
    if (route.request().method() === "PATCH") {
      expect(route.request().postDataJSON()).toEqual({
        values: {
          title: "新的名称",
          token: "",
          weight: 0.8,
          mode: "accurate",
          active: true,
        },
      });
      await route.fulfill({ json: { plugin: { name: "演示插件" }, fields } });
    } else
      await route.fulfill({ json: { plugin: { name: "演示插件" }, fields } });
  });
  await page.goto("/plugins/demo/settings");
  await page.getByRole("button", { name: "编辑设置", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("显示名称").fill("新的名称");
  await dialog.getByLabel("权重").fill("0.8");
  await dialog.getByLabel("运行方式").selectOption("accurate");
  await dialog.getByRole("button", { name: "保存修改" }).click();
  await expect(dialog).toHaveCount(0);
});

test("Basic media authentication works for native no-cors images and stays in one tab", async ({
  page,
  context,
}) => {
  await page.unrouteAll();
  await page.goto("/");
  await page.getByLabel("账号", { exact: true }).fill("admin");
  await page
    .getByLabel("密码", { exact: true })
    .fill("browser-fixture-password");
  await page.getByRole("button", { name: "进入工作台" }).click();
  await expect(
    page.getByRole("heading", { name: "工作台概览", exact: true }),
  ).toBeVisible();
  await page.evaluate(() => {
    const image = document.createElement("img");
    image.id = "native-auth-image";
    image.src = "/api/clips/1/cover";
    document.body.append(image);
  });
  await expect(page.locator("#native-auth-image")).toHaveJSProperty(
    "naturalWidth",
    32,
  );
  const other = await context.newPage();
  await other.goto("/");
  await expect(other.getByRole("heading", { name: "欢迎回来" })).toBeVisible();
  await other.evaluate(() => {
    const image = document.createElement("img");
    image.id = "other-tab-image";
    image.src = "/api/clips/1/cover";
    document.body.append(image);
  });
  await expect(other.locator("#other-tab-image")).toHaveJSProperty(
    "complete",
    true,
  );
  await expect(other.locator("#other-tab-image")).toHaveJSProperty(
    "naturalWidth",
    0,
  );
  await other.close();
});

test("running room settings omit locked flags while saving other changes", async ({
  page,
}) => {
  const room = {
    id: 1,
    room_id: 22758221,
    uploader_name: "验收主播",
    title: "录制中",
    authorized: true,
    running: true,
    source_available: true,
    recording_state: "recording",
    highlight_threshold: 0.6,
    review_threshold: 0.4,
    auto_approve_threshold: 0.8,
    auto_publish_threshold: 0.9,
    schedule_enabled: true,
    auto_threshold_enabled: true,
    danmaku_sentiment_enabled: true,
    auto_record: false,
    auto_analyze: true,
    auto_render: true,
    auto_approve: false,
    auto_upload: false,
  };
  await page.route("**/api/dashboard", (route) =>
    route.fulfill({ json: { rooms: [room], counts: {} } }),
  );
  await page.route("**/api/rooms/1", async (route) => {
    const body = route.request().postDataJSON();
    expect(body).not.toHaveProperty("schedule_enabled");
    expect(body).not.toHaveProperty("auto_threshold_enabled");
    expect(body).not.toHaveProperty("danmaku_sentiment_enabled");
    expect(body.auto_record).toBe(true);
    await route.fulfill({ json: { status: "updated" } });
  });
  await page.goto("/rooms");
  await page.getByRole("button", { name: "设置", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("switch", { name: "允许预约录制" }),
  ).toBeDisabled();
  await dialog.getByRole("switch", { name: "开播后自动录制" }).click();
  await dialog.getByRole("button", { name: "保存修改" }).click();
  await expect(dialog).toHaveCount(0);
});
