import { expect, it, vi } from "vitest";
const client = vi.hoisted(() => ({ upload: vi.fn(), api: vi.fn() }));
vi.mock("@/api/client", () => client);
import { runImport } from "./import-controller";
it("does not re-upload acknowledged files when resuming a record", async () => {
  client.api.mockResolvedValue({});
  await runImport({
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
    onRecord: vi.fn(),
  });
  expect(client.upload).not.toHaveBeenCalled();
  expect(client.api).toHaveBeenCalledExactlyOnceWith(
    "/api/recording-imports/abc/start",
    { method: "POST" },
  );
});
