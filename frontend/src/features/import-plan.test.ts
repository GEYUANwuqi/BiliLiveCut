import { describe, expect, it } from "vitest";
import { planImports } from "./import-plan";

const file = (name: string, body = "data"): File => new File([body], name);
const plan = (videos: string[], comments: string[] = []) =>
  planImports(
    videos.map((name) => file(name)),
    comments.map((name) => file(name)),
    100,
    50,
  );

describe("recording file pairing", () => {
  it("pairs normalized names and video extensions, naturally sorts every video", () => {
    const result = plan(
      ["片段10.mp4", "片段2.mp4", "CAFÉ.mp4"],
      ["cafe\u0301.XML", "片段2.mp4.xml"],
    );
    expect(result.map((item) => item.video.name)).toEqual([
      "片段2.mp4",
      "片段10.mp4",
      "CAFÉ.mp4",
    ]);
    expect(result.map((item) => item.comments?.name)).toEqual([
      "片段2.mp4.xml",
      undefined,
      "cafe\u0301.XML",
    ]);
  });
  it("keeps an explicitly selected single pair even when names differ", () => {
    expect(plan(["recording.mp4"], ["comments.xml"])[0].comments?.name).toBe(
      "comments.xml",
    );
  });
  it.each([
    [["a.mp4", "A.MKV"], [], "视频主文件名重复"],
    [["a.mp4", "b.mp4"], ["other.xml"], "弹幕没有对应视频"],
    [["a.mp4", "b.mp4"], ["a.xml", "A.JSON"], "同名弹幕"],
    [["a.mp4", "b.mp4"], ["a.xml", "a.mp4.xml"], "弹幕配对不唯一"],
    [["a.mp4", "a.mp4.mkv"], ["a.mp4.xml"], "弹幕配对不唯一"],
    [["a.mp4", "bad.exe"], [], "文件格式"],
    [["../a.mp4"], [], "文件名不支持"],
    [["bad\u0001.mp4"], [], "文件名不支持"],
    [[], [], "请选择视频"],
  ])(
    "rejects invalid batch %j before submission",
    (videos, comments, error) => {
      expect(() => plan(videos, comments)).toThrow(error);
    },
  );
  it("checks emptiness and individual size limits", () => {
    expect(() => planImports([file("a.mp4", "")], [], 100, 50)).toThrow(
      "文件为空",
    );
    expect(() => planImports([file("a.mp4")], [file("a.xml")], 100, 3)).toThrow(
      "大小限制",
    );
    expect(() => planImports([file("a.mp4")], [], 3, 50)).toThrow("大小限制");
  });
});
