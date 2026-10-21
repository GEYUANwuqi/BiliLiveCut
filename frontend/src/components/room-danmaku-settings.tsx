import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { LoaderCircle, MessageSquare, RotateCcw, Save } from "lucide-react";
import { toast } from "sonner";
import { send, type Row } from "@/api/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { FormField, type FieldSpec } from "@/components/workbench";
import { obj } from "@/lib/data";
import { useDraft } from "@/lib/drafts";

const defaults: Row = {
  danmaku_rate: 30,
  gift_rate: 80,
  superchat_rate: 100,
  interact_rate: 100,
  high_density_enabled: true,
  high_density_threshold: 1000,
  high_density_rate: 10,
};
const rates = [
  "danmaku_rate",
  "gift_rate",
  "superchat_rate",
  "interact_rate",
  "high_density_rate",
];
const fields: FieldSpec[] = [
  ...[
    ["danmaku_rate", "普通弹幕保留率（%）"],
    ["gift_rate", "礼物保留率（%）"],
    ["superchat_rate", "SC 保留率（%）"],
    ["interact_rate", "进场等互动保留率（%）"],
  ].map(([name, label]): FieldSpec => ({
    name,
    label,
    type: "number",
    min: 0,
    max: 100,
    step: 1,
    required: true,
  })),
  {
    name: "high_density_enabled",
    label: "启用高密度规则",
    type: "boolean",
    description: "超过阈值时，普通弹幕使用单独的保留率。",
  },
  {
    name: "high_density_threshold",
    label: "高密度阈值（条/分钟）",
    type: "number",
    min: 1,
    max: 1000000,
    step: 1,
    required: true,
  },
  {
    name: "high_density_rate",
    label: "高密度普通弹幕保留率（%）",
    type: "number",
    min: 0,
    max: 100,
    step: 1,
    required: true,
  },
];
export function RoomDanmakuSettings({ room }: { room: Row }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const cache = useQueryClient();
  const draft = useDraft<Row | null>(`room-danmaku-${room.id}`, null);
  const policy = obj(obj(room.room_config).danmaku_sampling);
  const saved = {
    ...defaults,
    ...Object.fromEntries(
      Object.entries(policy).map(([key, value]) => [
        key,
        rates.includes(key) ? Math.round(Number(value) * 100) : value,
      ]),
    ),
  };
  const values = draft.value ?? saved;
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const sampling = Object.fromEntries(
        fields.map((field) => {
          const value = values[field.name];
          if (field.type === "boolean") return [field.name, !!value];
          const numeric = Number(value);
          if (
            value === "" ||
            !Number.isInteger(numeric) ||
            numeric < Number(field.min) ||
            numeric > Number(field.max)
          )
            throw new Error(`${field.label}需要填写范围内的整数`);
          return [
            field.name,
            rates.includes(field.name) ? numeric / 100 : numeric,
          ];
        }),
      );
      await send(`/api/rooms/${room.id}`, "PATCH", {
        room_config: { danmaku_sampling: sampling },
      });
      draft.reset();
      setOpen(false);
      await cache.invalidateQueries({ queryKey: ["api"] });
      toast.success("本房间弹幕规则已保存，录制中约 5 秒内读取新规则");
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "保存失败，输入已保留",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) {
          setOpen(next);
          setError("");
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost">
          <MessageSquare className="size-3" />
          弹幕保留
        </Button>
      </DialogTrigger>
      <DialogContent
        className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl"
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>本直播间的弹幕保留规则</DialogTitle>
          <DialogDescription>
            只控制 Bilibili 弹幕进入分析数据库的比例。原始 JSONL
            仍保存采样前收到的业务消息，不受这些比例影响。
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => void save(event)} className="space-y-5">
          <fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2">
            {fields.map((field) => (
              <FormField
                key={field.name}
                field={{
                  ...field,
                  disabled:
                    field.name.startsWith("high_density_") &&
                    field.name !== "high_density_enabled" &&
                    !values.high_density_enabled,
                }}
                value={values[field.name]}
                onChange={(value) =>
                  draft.update({ ...values, [field.name]: value })
                }
              />
            ))}
          </fieldset>
          <p className="text-xs leading-6 text-muted-foreground">
            每项比例的 0% 表示该规则下不入库，100% 表示全部入库，精度为
            1%。启用高密度规则后，超过阈值的普通弹幕改用高密度保留率。密度按最近
            60
            秒内已识别消息的实际时间跨度折算。上舰等未映射消息仍只在原始档保留。规则仅作用于此房间，已保存的数据不重采样。
          </p>
          {error && (
            <p role="alert" className="error-panel">
              {error}；本步输入已保留。
            </p>
          )}
          <div className="flex flex-wrap justify-between gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => draft.update({ ...defaults })}
            >
              <RotateCcw className="size-4" />
              恢复默认值
            </Button>
            <div className="flex gap-2">
              {draft.dirty && (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    draft.reset();
                    setError("");
                  }}
                >
                  放弃修改
                </Button>
              )}
              <Button type="submit" disabled={busy || !draft.dirty}>
                {busy ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <Save className="size-4" />
                )}
                保存弹幕规则
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            恢复默认值后需点击保存才会生效；关闭窗口保留未保存的草稿。
          </p>
        </form>
      </DialogContent>
    </Dialog>
  );
}
