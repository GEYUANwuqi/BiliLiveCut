import type { Row } from "@/api/client";
import { number, obj, text } from "@/lib/data";

export function configurationSaveSummary(fields: Row[]): string {
  const restart = fields.filter((field) => field.pending_restart).length;
  const boundary = fields.filter(
    (field) => field.apply_mode === "safe_boundary",
  ).length;
  const immediate = fields.filter(
    (field) => field.apply_mode === "immediate",
  ).length;
  const parts = [
    restart ? `${restart} 项等待重启` : "",
    boundary ? `${boundary} 项将在各自安全边界使用新值` : "",
    immediate ? `${immediate} 项已供下一次读取使用` : "",
  ].filter(Boolean);
  return parts.length ? `配置已保存：${parts.join("；")}` : "配置已保存";
}

export function ConfigurationStatus({ field }: { field: Row }) {
  if (!field.apply_mode) return null;
  const retained = obj(field.retained_snapshots);
  const tasks = number(retained.task);
  const recordings = number(retained.recording);
  const effective = field.secret
    ? field.effective_configured
      ? "已设置"
      : "未设置"
    : typeof field.effective === "boolean"
      ? field.effective
        ? "开启"
        : "关闭"
      : text(field.effective);
  return (
    <div
      className="space-y-1 rounded-lg bg-muted/50 p-3 text-xs leading-6"
      aria-label="配置生效状态"
    >
      <p>{text(field.effect_description, "按标注的生效边界应用配置")}</p>
      {Boolean(field.pending_restart) && (
        <p role="status" className="font-medium text-primary">
          已保存，等待重启。当前进程值：{effective}
        </p>
      )}
      {!field.pending_restart && Boolean(field.pending_service) && (
        <p role="status">
          已保存，当前服务尚未读取新配置。当前服务值：{effective}
        </p>
      )}
      {tasks + recordings > 0 && (
        <p role="status">
          仍有 {tasks} 个任务、{recordings}{" "}
          个录制保留旧配置快照；结束后释放，新的运行单元使用新值。
        </p>
      )}
    </div>
  );
}
