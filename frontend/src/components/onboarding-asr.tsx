import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { LoaderCircle, Save } from "lucide-react";
import { ApiError, send, useApi, type Row } from "@/api/client";
import { FormField, QueryState, type FieldSpec } from "@/components/workbench";
import { Button } from "@/components/ui/button";
import { useDraft } from "@/lib/drafts";
import { obj, rows } from "@/lib/data";

const fields: FieldSpec[] = [
  {
    name: "asr_primary",
    label: "转写方式",
    options: [
      { label: "远程 API（OpenAI 兼容）", value: "openai_compatible" },
      { label: "本地 FunASR Nano", value: "funasr_nano" },
      { label: "本地 Paraformer", value: "paraformer" },
      { label: "本地 Whisper", value: "whisper" },
    ],
  },
  {
    name: "asr_remote_base_url",
    label: "转写 API 地址",
    placeholder: "https://api.example.com/v1",
    required: true,
  },
  { name: "asr_remote_model", label: "转写模型 ID", required: true },
  {
    name: "asr_remote_api_key",
    label: "转写 API 密钥",
    type: "password",
    description: "留空保留已有密钥；无需鉴权的自建服务可不填。",
  },
];
export function OnboardingAsr({ onBusy }: { onBusy: (busy: boolean) => void }) {
  const query = useApi("/api/settings/configuration", false);
  const models = useApi("/api/model-configuration", false);
  const draft = useDraft<Row>("onboarding-asr", {});
  const cache = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const view = obj(query.data);
  const current = Object.fromEntries(
    rows(view.fields).map((field) => [
      String(field.key),
      field.secret ? "" : field.value,
    ]),
  );
  const values = { ...current, ...draft.value };
  const remote = values.asr_primary === "openai_compatible";
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    onBusy(true);
    setError("");
    try {
      await send("/api/settings/configuration", "PATCH", {
        revision: draft.value.revision ?? view.revision,
        values: Object.fromEntries(
          Object.entries(draft.value).filter(
            ([key, value]) =>
              key !== "revision" &&
              !(key === "asr_remote_api_key" && value === ""),
          ),
        ),
      });
      draft.reset();
      await cache.invalidateQueries({
        queryKey: ["api", "/api/settings/configuration"],
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "配置保存失败");
      setConflict(reason instanceof ApiError && reason.status === 409);
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }
  return (
    <QueryState query={query}>
      <div className="space-y-5">
        <p className="text-sm leading-7 text-muted-foreground">
          ASR 把视频语音转成文字。远程 API
          可以把转写计算交给服务端；本地引擎需要安装对应依赖，并在首次使用时准备模型。没有
          API 也可以稍后再设置。
        </p>
        <form onSubmit={(event) => void save(event)} className="space-y-5">
          <fieldset disabled={busy} className="grid gap-5 sm:grid-cols-2">
            {[
              fields[0],
              {
                name: "asr_remote_route_id",
                label: "远程转写路由",
                disabled: models.isPending || models.isError,
                description:
                  "可选择已保存的共享连接路由，或使用独立 API 配置。",
                options: [
                  { value: "", label: "使用独立 API 配置" },
                  ...rows(obj(models.data).routes)
                    .filter(
                      (route) =>
                        route.capability === "asr" &&
                        route.enabled &&
                        rows(obj(models.data).connections).some(
                          (connection) =>
                            connection.id === route.connection_id &&
                            connection.enabled,
                        ),
                    )
                    .map((route) => ({
                      value: String(route.id),
                      label: `${route.name} · ${route.model}`,
                    })),
                ],
              },
              ...fields.slice(1),
            ]
              .filter(
                (field) =>
                  field.name === "asr_primary" ||
                  (remote &&
                    (field.name === "asr_remote_route_id" ||
                      !values.asr_remote_route_id)),
              )
              .map((field) => (
                <FormField
                  key={field.name}
                  field={field}
                  value={values[field.name] ?? ""}
                  onChange={(value) =>
                    draft.update({
                      ...draft.value,
                      revision: draft.dirty
                        ? draft.value.revision
                        : view.revision,
                      [field.name]: value,
                    })
                  }
                />
              ))}
          </fieldset>
          {remote ? (
            <p className="rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm leading-6">
              选择远程转写并保存后，执行转写任务时会把音频发送给你填写的服务。请使用你信任的地址和服务实际支持的模型
              ID。
            </p>
          ) : (
            <p className="rounded-xl bg-muted p-4 text-sm leading-6">
              当前选择本地转写。引导不会下载模型或启动转写，模型、设备和并发可稍后在“设置中心
              → 语音转写”调整。
            </p>
          )}
          {error && (
            <p role="alert" className="error-panel">
              {error}；输入已保留，请修改后重试。
            </p>
          )}
          {conflict && (
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                onBusy(true);
                try {
                  const latest = await query.refetch();
                  if (latest.error) throw latest.error;
                  draft.update({
                    ...draft.value,
                    revision: obj(latest.data).revision,
                  });
                  setConflict(false);
                  setError("");
                } catch (reason) {
                  setError(
                    reason instanceof Error
                      ? reason.message
                      : "读取最新配置失败",
                  );
                } finally {
                  setBusy(false);
                  onBusy(false);
                }
              }}
            >
              读取最新配置，保留本步输入
            </Button>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={!draft.dirty || busy || conflict}>
              {busy ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Save className="size-4" />
              )}
              保存转写设置
            </Button>
            {draft.dirty ? (
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  draft.reset();
                  setError("");
                  setConflict(false);
                }}
              >
                放弃本步修改
              </Button>
            ) : (
              <span className="text-xs text-muted-foreground">
                当前显示已保存的配置，继续下一步不会修改它。
              </span>
            )}
          </div>
        </form>
      </div>
    </QueryState>
  );
}
