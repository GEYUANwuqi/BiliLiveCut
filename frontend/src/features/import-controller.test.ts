import { beforeEach, expect, it, vi } from "vitest";
const client = vi.hoisted(() => ({ upload: vi.fn(), api: vi.fn() }));
vi.mock("@/api/client", () => client);
import {
  runImportBatch,
  cancelImportUpload,
  type ImportItem,
} from "./import-controller";
beforeEach(() => {
  client.api.mockReset();
  client.upload.mockReset();
});
it("does not re-upload acknowledged files when resuming a record", async () => {
  const record = {
    id: "abc",
    title: "video",
    video_name: "test.mp4",
    video_uploaded: true,
    comments_name: null,
    sealed: false,
  };
  client.api
    .mockResolvedValueOnce({ imports: [record] })
    .mockResolvedValueOnce({});
  await runImportBatch(
    [
      {
        declaration: {},
        record: {
          id: "abc",
          title: "video",
          video_name: "test.mp4",
          video_uploaded: true,
          comments_name: null,
          sealed: false,
        },
        video: new File(["video"], "test.mp4"),
      },
    ],
    vi.fn(),
  );
  expect(client.upload).not.toHaveBeenCalled();
  expect(client.api.mock.calls.at(-1)).toEqual([
    "/api/recording-imports/abc/start",
    { method: "POST" },
  ]);
});

const item = (id: string): ImportItem => ({
  declaration: {
    request_id: id,
    video_name: `${id}.mp4`,
    comments_name: `${id}.xml`,
  },
  video: new File(["video"], `${id}.mp4`),
  comments: new File(["comments"], `${id}.xml`),
});
it("uploads sequentially and resumes only unfinished files and batches", async () => {
  let queue = [item("one"), item("two")];
  const records: Record<string, Record<string, unknown>> = {};
  const events: string[] = [];
  let fail = true;
  client.api.mockImplementation(async (path: string, options?: RequestInit) => {
    if (path.endsWith("/start")) {
      events.push(path);
      return {};
    }
    if (options?.method === "POST") {
      const body = JSON.parse(String(options.body));
      return (records[body.request_id] ||= { ...body, id: body.request_id });
    }
    return { imports: Object.values(records) };
  });
  client.upload.mockImplementation(async (path: string) => {
    events.push(path);
    if (path.endsWith("two/files/comments") && fail) {
      fail = false;
      throw new Error("connection lost");
    }
    const [, , , id, , kind] = path.split("/");
    return (records[id] = { ...records[id], [`${kind}_uploaded`]: true });
  });
  const save = (index: number, next: ImportItem): void => {
    queue = queue.map((entry, i) => (i === index ? next : entry));
  };
  await expect(runImportBatch(queue, save)).rejects.toThrow("connection lost");
  expect(queue[0].submitted).toBe(true);
  expect(queue[1].record?.video_uploaded).toBe(true);
  await runImportBatch(queue, save);
  expect(queue.every((entry) => entry.submitted)).toBe(true);
  expect(events).toEqual([
    "/api/recording-imports/one/files/video",
    "/api/recording-imports/one/files/comments",
    "/api/recording-imports/one/start",
    "/api/recording-imports/two/files/video",
    "/api/recording-imports/two/files/comments",
    "/api/recording-imports/two/files/comments",
    "/api/recording-imports/two/start",
  ]);
});
it("stops the remaining queue and rejects a second concurrent batch", async () => {
  let release!: () => void;
  client.api.mockImplementation(async (_path: string, options: RequestInit) => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return { ...JSON.parse(String(options.body)), id: "one" };
  });
  const save = vi.fn();
  const pending = runImportBatch([item("one"), item("two")], save);
  await expect(runImportBatch([item("other")], vi.fn())).rejects.toThrow(
    "已有上传",
  );
  cancelImportUpload();
  release();
  await expect(pending).rejects.toThrow("上传已停止");
  expect(client.upload).not.toHaveBeenCalled();
  expect(client.api).toHaveBeenCalledTimes(1);
  expect(save.mock.calls[0][1].record.id).toBe("one");
});
it("reuses the declaration id after a lost creation response", async () => {
  const queue = [item("stable")];
  client.api.mockRejectedValueOnce(new Error("lost response"));
  await expect(runImportBatch(queue, vi.fn())).rejects.toThrow("lost response");
  client.api
    .mockResolvedValueOnce({
      id: "stable",
      video_uploaded: true,
      comments_uploaded: true,
    })
    .mockResolvedValueOnce({});
  await runImportBatch(queue, vi.fn());
  expect(client.api.mock.calls[0][1].body).toBe(
    client.api.mock.calls[1][1].body,
  );
  expect(client.upload).not.toHaveBeenCalled();
});
it("reconciles a lost upload acknowledgement before resuming", async () => {
  const record = {
    id: "abc",
    video_name: "abc.mp4",
    video_uploaded: true,
    comments_name: null,
  };
  client.api
    .mockResolvedValueOnce({ imports: [record] })
    .mockResolvedValueOnce({});
  await runImportBatch(
    [{ declaration: {}, record: { ...record, video_uploaded: false } }],
    vi.fn(),
  );
  expect(client.upload).not.toHaveBeenCalled();
});
