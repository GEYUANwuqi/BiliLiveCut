import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  onboardingKey,
  readIntro,
  subscribeIntro,
  writeIntro,
} from "./onboarding";

beforeEach(() => localStorage.clear());
describe("first meeting preferences", () => {
  it("remembers completion per administrator identity", () => {
    const first = onboardingKey("session", "admin");
    expect(readIntro(first)).toBe("setup:0");
    writeIntro(first, "done");
    expect(readIntro(first)).toBe("done");
    expect(readIntro(onboardingKey("session", "another-admin"))).toBe(
      "setup:0",
    );
    expect(localStorage.getItem(first)).toBe("done");
  });
  it.each(["setup:99", "tour:6", "setup:-1", "invalid", "{}"])(
    "ignores invalid persisted progress %s",
    (value) => {
      localStorage.setItem("invalid-progress", value);
      expect(readIntro("invalid-progress")).toBe("setup:0");
    },
  );
  it("resumes progress and observes another tab's changes", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeIntro(listener);
    writeIntro("shared", "setup:2");
    expect(readIntro("shared")).toBe("setup:2");
    localStorage.setItem("shared", "done");
    window.dispatchEvent(new Event("storage"));
    expect(listener).toHaveBeenCalledTimes(2);
    expect(readIntro("shared")).toBe("done");
    unsubscribe();
  });
  it("can finish when browser storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("unavailable");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("unavailable");
    });
    writeIntro("storage-disabled", "done");
    expect(readIntro("storage-disabled")).toBe("done");
  });
});
