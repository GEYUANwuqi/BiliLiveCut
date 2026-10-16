import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it } from "vitest";
import { clearDrafts, hasDrafts, useDraft } from "./drafts";
beforeEach(clearDrafts);
it("retains local edits across page changes without marking server values dirty", () => {
  const first = renderHook(() => useDraft("review-1", { reason: "server" }));
  expect(hasDrafts()).toBe(false);
  act(() => first.result.current.update({ reason: "my edit" }));
  expect(hasDrafts()).toBe(true);
  first.unmount();
  const second = renderHook(() => useDraft("review-1", { reason: "new poll" }));
  expect(second.result.current.value.reason).toBe("my edit");
  act(() => second.result.current.reset());
  expect(hasDrafts()).toBe(false);
});
it("explicit identity reset removes previous user drafts", () => {
  const first = renderHook(() => useDraft("secret", ""));
  act(() => first.result.current.update("private"));
  act(clearDrafts);
  expect(first.result.current.value).toBe("");
});
