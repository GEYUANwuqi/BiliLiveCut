import { test, expect } from "@playwright/test";

test("batch imports retain matching and acknowledged files across retry and navigation", async ({
  page,
}) => {
  const records = new Map<string, Record<string, unknown>>();
  const uploaded: string[] = [];
  const submitted: string[] = [];
  let fail = true;
  await page.route("**/*", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (!path.startsWith("/api/") && !path.startsWith("/auth/"))
      return route.continue();
    let data: unknown = [];
    if (path === "/auth/status") data = { enabled: false };
    if (path === "/api/dashboard")
      data = { rooms: [], live_sources: [], counts: {} };
    if (path === "/api/jobs") data = { jobs: [] };
    if (path === "/api/recording-imports") {
      if (request.method() === "POST") {
        const declaration = request.postDataJSON() as Record<string, unknown>;
        const id = String(declaration.request_id);
        data = { ...declaration, id };
        records.set(id, data as Record<string, unknown>);
      } else
        data = {
          imports: [...records.values()],
          max_video_bytes: 10000,
          max_comment_bytes: 10000,
        };
    } else if (path.startsWith("/api/recording-imports/")) {
      const [, , , id, operation, kind] = path.split("/");
      const record = records.get(id)!;
      if (operation === "files") {
        uploaded.push(`${record.video_name}:${kind}`);
        if (record.video_name === "录像10.mp4" && kind === "comments" && fail) {
          fail = false;
          return route.fulfill({
            status: 503,
            json: { detail: "测试连接中断" },
          });
        }
        record[`${kind}_uploaded`] = true;
        data = record;
      } else {
        submitted.push(String(record.video_name));
        record.sealed = true;
        data = { job: { id: `job-${id}`, status: "queued" } };
      }
    }
    await route.fulfill({ json: data });
  });
  await page.goto("/imports");
  const files = (names: string[]) =>
    names.map((name) => ({
      name,
      mimeType: "application/octet-stream",
      buffer: Buffer.from("fixture"),
    }));
  await page
    .getByLabel("选择录播视频")
    .setInputFiles(files(["录像10.mp4", "录像2.mp4"]));
  await page
    .getByLabel("选择弹幕文件")
    .setInputFiles(files(["录像2.xml", "录像10.mp4.xml"]));
  const queue = page.getByLabel("文件配对与上传队列");
  await expect(queue).toContainText("录像2.mp4 → 录像2.xml");
  await expect(queue).toContainText("录像10.mp4 → 录像10.mp4.xml");
  await page
    .getByRole("button", { name: "上传并开始分析", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "继续上传并分析", exact: true }),
  ).toBeVisible();
  await expect(queue).toContainText("已提交 1 段");
  await page.evaluate(() => {
    history.pushState({}, "", "/rooms");
    dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(
    page.getByRole("heading", { name: "直播间", exact: true }),
  ).toBeVisible();
  await page.evaluate(() => {
    history.pushState({}, "", "/imports");
    dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(queue).toContainText("已提交 1 段");
  await page
    .getByRole("button", { name: "继续上传并分析", exact: true })
    .click();
  await expect(queue).toHaveCount(0);
  expect(submitted).toEqual(["录像2.mp4", "录像10.mp4"]);
  expect(uploaded).toEqual([
    "录像2.mp4:video",
    "录像2.mp4:comments",
    "录像10.mp4:video",
    "录像10.mp4:comments",
    "录像10.mp4:comments",
  ]);
  expect(records.size).toBe(2);
  expect([...records.values()].map((record) => record.title)).toEqual([
    "录像2",
    "录像10",
  ]);
});

test("a wrong resume filename can be corrected before the queue is frozen", async ({
  page,
}) => {
  const record = {
    id: "saved",
    title: "saved video",
    video_name: "saved.mp4",
    comments_name: null,
    video_uploaded: false,
    sealed: false,
  };
  let uploads = 0;
  await page.route("**/*", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (!path.startsWith("/api/") && !path.startsWith("/auth/"))
      return route.continue();
    let data: unknown = [];
    if (path === "/auth/status") data = { enabled: false };
    if (path === "/api/dashboard") data = { rooms: [], counts: {} };
    if (path === "/api/jobs") data = { jobs: [] };
    if (path === "/api/recording-imports") data = { imports: [record] };
    if (path.endsWith("/files/video")) {
      uploads++;
      record.video_uploaded = true;
      data = record;
    }
    if (path.endsWith("/start")) {
      record.sealed = true;
      data = { job: {} };
    }
    await route.fulfill({ json: data });
  });
  await page.goto("/imports");
  await page.getByRole("button", { name: "继续上传", exact: true }).click();
  const input = page.getByLabel("选择录播视频");
  await input.setInputFiles({
    name: "wrong.mp4",
    mimeType: "video/mp4",
    buffer: Buffer.from("video"),
  });
  await expect(
    page.getByText("请重新选择 saved.mp4", { exact: true }),
  ).toBeVisible();
  expect(uploads).toBe(0);
  await input.setInputFiles({
    name: "saved.mp4",
    mimeType: "video/mp4",
    buffer: Buffer.from("video"),
  });
  await page
    .getByRole("button", { name: "继续上传并分析", exact: true })
    .click();
  await expect(page.getByLabel("文件配对与上传队列")).toHaveCount(0);
  await expect.poll(() => uploads).toBe(1);
});
