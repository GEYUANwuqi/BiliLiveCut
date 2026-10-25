import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import {
  ConfigurationStatus,
  configurationSaveSummary,
} from "./configuration-status";

it("shows the current startup value while a saved change waits for restart", () => {
  render(
    <ConfigurationStatus
      field={{
        apply_mode: "restart",
        pending_restart: true,
        saved: true,
        effective: false,
      }}
    />,
  );
  expect(screen.getByRole("status")).toHaveTextContent(
    "已保存，等待重启。当前进程值：关闭",
  );
});

it("shows retained task and recording snapshots without claiming all work has switched", () => {
  render(
    <ConfigurationStatus
      field={{
        apply_mode: "safe_boundary",
        retained_snapshots: { task: 2, recording: 1 },
      }}
    />,
  );
  expect(screen.getByRole("status")).toHaveTextContent(
    "2 个任务、1 个录制保留旧配置快照",
  );
});

it("never renders saved or effective credentials, including an invalid unmasked response", () => {
  const { container } = render(
    <ConfigurationStatus
      field={{
        apply_mode: "restart",
        pending_restart: true,
        secret: true,
        saved: "saved-private",
        effective: "current-private",
        effective_configured: true,
      }}
    />,
  );
  expect(screen.getByRole("status")).toHaveTextContent("当前进程值：已设置");
  expect(container.innerHTML).not.toContain("private");
});

it("distinguishes a pending process refresh from retained snapshots", () => {
  render(
    <ConfigurationStatus
      field={{
        apply_mode: "safe_boundary",
        pending_service: true,
        effective: 20,
      }}
    />,
  );
  expect(screen.getByRole("status")).toHaveTextContent(
    "当前服务尚未读取新配置。当前服务值：20",
  );
});

it("summarizes mixed changes using their actual returned application state", () => {
  expect(
    configurationSaveSummary([
      { apply_mode: "restart", pending_restart: true },
      { apply_mode: "safe_boundary" },
      { apply_mode: "immediate" },
    ]),
  ).toBe(
    "配置已保存：1 项等待重启；1 项将在各自安全边界使用新值；1 项已供下一次读取使用",
  );
  expect(
    configurationSaveSummary([
      { apply_mode: "restart", pending_restart: false },
    ]),
  ).toBe("配置已保存");
});
