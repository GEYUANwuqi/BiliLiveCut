import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormField, type FieldSpec } from "@/components/workbench";
import { obj, rows, text } from "@/lib/data";
import type { Row } from "@/api/client";

const labels: Record<string, string> = {
  name: "名称",
  description: "描述",
  enabled: "启用",
  is_default: "设为默认",
  font_name: "字体",
  font_size: "字号",
  primary_color: "文字颜色",
  secondary_color: "次要颜色",
  outline_color: "描边颜色",
  back_color: "背景颜色",
  bold: "粗体",
  italic: "斜体",
  underline: "下划线",
  strikeout: "删除线",
  scale_x: "水平缩放",
  scale_y: "垂直缩放",
  spacing: "字符间距",
  angle: "旋转角度",
  border_style: "边框样式",
  outline: "描边宽度",
  shadow: "阴影",
  alignment: "字幕对齐",
  margin_l: "左边距",
  margin_r: "右边距",
  margin_v: "垂直边距",
  encoding: "编码",
  max_chars_per_line: "每行最多字符",
  min_display_ms: "最短显示（毫秒）",
  max_display_ms: "最长显示（毫秒）",
  line_gap_ms: "行间隔（毫秒）",
  play_res_x: "画布宽度",
  play_res_y: "画布高度",
  intro_enabled: "启用片头",
  intro_text: "片头文字",
  intro_duration_s: "片头时长（秒）",
  intro_font_name: "片头字体",
  intro_font_size: "片头字号",
  intro_font_color: "片头文字颜色",
  intro_bg_color: "片头背景颜色",
  outro_enabled: "启用片尾",
  outro_text: "片尾文字",
  outro_duration_s: "片尾时长（秒）",
  outro_font_name: "片尾字体",
  outro_font_size: "片尾字号",
  outro_font_color: "片尾文字颜色",
  outro_bg_color: "片尾背景颜色",
  volume: "音量权重",
  danmaku: "弹幕权重",
  keywords: "关键词权重",
  speech_rate: "语速权重",
  audio_events: "音频事件权重",
  trend: "网感权重",
  laughter: "笑声权重",
  danmaku_sentiment: "弹幕情绪权重",
  alpha: "规则分融合系数",
  beta: "大模型分融合系数",
  pre_roll_s: "前置留白（秒）",
  post_roll_s: "后置留白（秒）",
  iou_threshold: "重叠去重阈值",
  cooldown_s: "冷却时间（秒）",
  base_url: "接口地址",
  api_key: "API 密钥",
  timeout_s: "超时（秒）",
  model: "模型",
  language: "语言",
  priority: "优先级",
  threshold: "阈值",
  title: "标题",
  summary: "摘要",
  tags: "标签",
  text: "文本",
};

export const labelFor = (key: string, schema: Row = {}) =>
  labels[key] || text(schema.title, key.replaceAll("_", " "));

function resolve(schema: Row, root: Row): Row {
  if (typeof schema.$ref === "string") {
    const target = obj(obj(root.$defs)[schema.$ref.split("/").pop() || ""]);
    const metadata = { ...schema };
    delete metadata.$ref;
    return { ...metadata, ...target };
  }
  if (Array.isArray(schema.anyOf)) {
    const branch = obj(
      schema.anyOf.find((entry) => obj(entry).type !== "null"),
    );
    const metadata = { ...schema };
    delete metadata.anyOf;
    return { ...metadata, ...resolve(branch, root) };
  }
  return schema;
}

export function fieldSpec(
  name: string,
  schema: Row,
  required = false,
): FieldSpec {
  const type = schema.type;
  return {
    name,
    label: labelFor(name, schema),
    required,
    description:
      typeof schema.description === "string" ? schema.description : undefined,
    type:
      type === "boolean"
        ? "boolean"
        : type === "integer" || type === "number"
          ? "number"
          : type === "object"
            ? "json"
            : type === "array"
              ? "lines"
              : schema.format === "password"
                ? "password"
                : "text",
    min: typeof schema.minimum === "number" ? schema.minimum : undefined,
    max: typeof schema.maximum === "number" ? schema.maximum : undefined,
    step: type === "integer" ? 1 : undefined,
    options: Array.isArray(schema.enum)
      ? schema.enum.map((value) => ({
          label: String(value),
          value: String(value),
        }))
      : undefined,
  };
}

export function schemaDefaults(raw: Row, root: Row = raw): unknown {
  const schema = resolve(raw, root);
  if (schema.default !== undefined) return schema.default;
  if (schema.type === "object")
    return Object.fromEntries(
      Object.entries(obj(schema.properties)).map(([key, value]) => [
        key,
        schemaDefaults(obj(value), root),
      ]),
    );
  if (schema.type === "array") return [];
  if (schema.type === "boolean") return false;
  if (schema.enum) return (schema.enum as unknown[])[0];
  if (schema.type === "number" || schema.type === "integer")
    return schema.minimum ?? 0;
  return "";
}

export function SchemaFields({
  schema: raw,
  value,
  onChange,
  disabled = false,
  prefix = "",
  root: suppliedRoot,
}: {
  schema: Row;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled?: boolean;
  prefix?: string;
  root?: Row;
}) {
  const root = suppliedRoot || raw;
  const schema = resolve(raw, root);
  if (schema.type === "object" && Object.keys(obj(schema.properties)).length) {
    const current = obj(value);
    const required = Array.isArray(schema.required) ? schema.required : [];
    return (
      <div className="grid gap-4">
        {Object.entries(obj(schema.properties)).map(([key, definition]) => {
          const child = resolve(obj(definition), root);
          const field = fieldSpec(
            `${prefix}${key}`,
            child,
            required.includes(key),
          );
          field.label = labelFor(key, child);
          return ["object", "array"].includes(String(child.type)) ? (
            <fieldset className="space-y-3 rounded-xl border p-4" key={key}>
              <legend className="px-1 text-sm font-medium">
                {field.label}
              </legend>
              <SchemaFields
                schema={child}
                root={root}
                prefix={`${prefix}${key}.`}
                value={current[key] ?? schemaDefaults(child, root)}
                onChange={(next) => onChange({ ...current, [key]: next })}
                disabled={disabled}
              />
            </fieldset>
          ) : (
            <FormField
              key={key}
              field={field}
              value={current[key] ?? child.default}
              onChange={(next) =>
                onChange({
                  ...current,
                  [key]:
                    child.type === "number" || child.type === "integer"
                      ? next === ""
                        ? ""
                        : Number(next)
                      : next,
                })
              }
              disabled={disabled}
            />
          );
        })}
      </div>
    );
  }
  if (
    schema.type === "array" &&
    resolve(obj(schema.items), root).type === "object"
  ) {
    return (
      <div className="space-y-4">
        {rows(value).map((item, index) => (
          <div key={index} className="space-y-3 rounded-xl border p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                第 {index + 1} 项
              </span>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label={`删除第 ${index + 1} 项`}
                disabled={disabled}
                onClick={() =>
                  onChange((value as unknown[]).filter((_, i) => i !== index))
                }
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
            <SchemaFields
              schema={obj(schema.items)}
              root={root}
              value={item}
              onChange={(next) =>
                onChange(
                  (value as unknown[]).map((entry, i) =>
                    i === index ? next : entry,
                  ),
                )
              }
              disabled={disabled}
              prefix={`${prefix}${index}.`}
            />
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          onClick={() =>
            onChange([
              ...(Array.isArray(value) ? value : []),
              schemaDefaults(obj(schema.items), root),
            ])
          }
        >
          <Plus className="size-3.5" />
          添加一项
        </Button>
      </div>
    );
  }
  const field = fieldSpec(prefix || "value", schema);
  return (
    <FormField
      field={field}
      value={value}
      onChange={(next) => {
        if (schema.type === "object") onChange(next);
        else if (schema.type === "array")
          onChange(String(next).split("\n").filter(Boolean));
        else onChange(next);
      }}
      disabled={disabled}
    />
  );
}

export function normalizeSchema(
  raw: Row,
  value: unknown,
  root: Row = raw,
): unknown {
  const schema = resolve(raw, root);
  if (schema.type === "object") {
    let source = value;
    if (typeof source === "string") {
      try {
        source = JSON.parse(source);
      } catch {
        throw new Error("对象配置不是有效的 JSON");
      }
    }
    if (!source || typeof source !== "object" || Array.isArray(source))
      throw new Error("配置必须是对象");
    const definitions = obj(schema.properties);
    return Object.fromEntries(
      Object.entries(source).map(([key, entry]) => [
        key,
        definitions[key]
          ? normalizeSchema(obj(definitions[key]), entry, root)
          : entry,
      ]),
    );
  }
  if (schema.type === "array")
    return (Array.isArray(value) ? value : []).map((item) =>
      normalizeSchema(obj(schema.items), item, root),
    );
  if (schema.type === "number" || schema.type === "integer") {
    if (value === "" || !Number.isFinite(Number(value)))
      throw new Error("数值配置必须为有效数字");
    return Number(value);
  }
  return value;
}
