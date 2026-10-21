import type { Row } from "@/api/client";

export const obj = (value: unknown): Row =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Row)
    : {};
export const rows = (value: unknown): Row[] =>
  Array.isArray(value) ? value.map(obj) : [];
export const text = (value: unknown, fallback = "—") =>
  value === undefined || value === null || value === ""
    ? fallback
    : typeof value === "object"
      ? JSON.stringify(value)
      : String(value);
export const number = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;
export const time = (value: unknown, zone: "local" | "GMT+8" = "local") => {
  if (!value) return "—";
  const source = String(value);
  const date = new Date(
    /[zZ]|[+-]\d\d:\d\d$/.test(source) ? source : `${source}Z`,
  );
  return Number.isNaN(date.getTime())
    ? source
    : new Intl.DateTimeFormat("zh-CN", {
        dateStyle: "short",
        timeStyle: "medium",
        timeZone: zone === "GMT+8" ? "Asia/Shanghai" : undefined,
      }).format(date) + (zone === "GMT+8" ? " GMT+8" : "");
};
export function duration(value: unknown) {
  const seconds = Math.max(0, Math.round(number(value)));
  return `${Math.floor(seconds / 3600) ? `${Math.floor(seconds / 3600)}:` : ""}${String(Math.floor(seconds / 60) % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
export const title = (row: Row) =>
  text(
    row.title || row.name || row.uploader_name || row.label || row.id,
    "未命名",
  );
