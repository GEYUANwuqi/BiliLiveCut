import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Check, LoaderCircle, Mail, Save, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { send, useApi, type Row } from "@/api/client";
import {
  FormField,
  Page,
  QueryState,
  type FieldSpec,
} from "@/components/workbench";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useDraft } from "@/lib/drafts";
import { obj, rows, text, time } from "@/lib/data";

const transportFields: FieldSpec[] = [
  { name: "smtp_host", label: "SMTP 服务器", placeholder: "smtp.example.com" },
  { name: "smtp_port", label: "SMTP 端口", type: "number", min: 1, max: 65535 },
  {
    name: "smtp_security",
    label: "连接方式",
    options: [
      { label: "SSL / TLS（常用端口 465）", value: "ssl" },
      { label: "STARTTLS（常用端口 587）", value: "starttls" },
      { label: "明文 SMTP（可信内网中继）", value: "plain" },
    ],
  },
  {
    name: "smtp_user",
    label: "SMTP 用户名",
    description: "通常为发件邮箱；无认证中继可留空。",
  },
  {
    name: "smtp_password",
    label: "SMTP 密码或授权码",
    type: "password",
    description: "留空保留已保存的凭据。",
  },
  {
    name: "smtp_from",
    label: "发件邮箱",
    description: "留空时使用 SMTP 用户名。",
  },
  {
    name: "smtp_to",
    label: "目标邮箱",
    description: "只支持一个收件邮箱，保存后需输入邮件验证码验证。",
  },
];
const ruleFields: FieldSpec[] = [
  { name: "notify_enabled", label: "启用运行提醒", type: "boolean" },
  {
    name: "notify_on_connection",
    label: "登录态与 WS 连接异常",
    type: "boolean",
    description: "Cookie 明确失效，或 WS 连续三次连接失败时提醒。",
  },
  { name: "notify_on_error", label: "任务失败", type: "boolean" },
  { name: "notify_on_disk_alert", label: "磁盘空间不足", type: "boolean" },
  { name: "notify_on_clip", label: "成片完成", type: "boolean" },
  { name: "notify_on_upload", label: "投稿完成", type: "boolean" },
  {
    name: "notify_connection_cooldown_s",
    label: "同房间同类连接提醒间隔（秒）",
    type: "number",
    min: 60,
    max: 86400,
    description: "默认 1800 秒，避免重连期间反复发送相同提醒。",
  },
];

const larkFields: FieldSpec[] = [
  { name: "lark_app_id", label: "App ID", placeholder: "cli_…" },
  {
    name: "lark_app_secret",
    label: "App Secret",
    type: "password",
    description: "留空保留已保存的密钥。",
  },
  {
    name: "lark_domain",
    label: "服务区域",
    options: [
      { label: "飞书（中国）", value: "feishu" },
      { label: "Lark（国际版）", value: "lark" },
    ],
  },
  {
    name: "lark_receive_id_type",
    label: "接收对象类型",
    options: [
      { label: "群聊 chat_id", value: "chat_id" },
      { label: "用户 open_id", value: "open_id" },
      { label: "用户 union_id", value: "union_id" },
      { label: "用户 user_id", value: "user_id" },
      { label: "用户 email", value: "email" },
    ],
  },
  {
    name: "lark_receive_id",
    label: "接收对象 ID",
    placeholder: "oc_… 或对应类型的用户 ID",
    description: "向群聊发送时需先将应用机器人加入目标群。",
  },
];

export default function NotificationsPage() {
  const configuration = useApi("/api/settings/configuration", false);
  const status = useApi("/api/settings/notifications/email", 10000);
  const cache = useQueryClient();
  const draft = useDraft<Row>("notification-settings", {});
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [code, setCode] = useState("");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const view = obj(configuration.data);
  const fields = rows(view.fields);
  const initial = Object.fromEntries(
    fields.map((field) => [String(field.key), field.secret ? "" : field.value]),
  );
  const changes = obj(draft.value.changes);
  const values = { ...initial, ...changes };
  const state = obj(status.data);
  const resend = Math.max(
    0,
    Math.ceil(
      Number(state.resend_after_s || 0) -
        Math.max(0, now - status.dataUpdatedAt) / 1000,
    ),
  );
  const verified = state.verified === true;
  const delivery = obj(state.delivery);

  function change(key: string, value: unknown) {
    setError("");
    draft.update({
      revision: draft.dirty ? draft.value.revision : view.revision,
      changes: { ...changes, [key]: value },
    });
  }
  async function act(
    name: string,
    action: () => Promise<unknown>,
    success: string,
  ) {
    setBusy(name);
    setError("");
    try {
      await action();
      await cache.invalidateQueries({ queryKey: ["api"] });
      toast.success(success);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "操作失败，请重试");
    } finally {
      await cache.invalidateQueries({
        queryKey: ["api", "/api/settings/notifications/email"],
      });
      setBusy("");
    }
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    await act(
      "save",
      async () => {
        const payload = Object.fromEntries(
          Object.entries(changes)
            .filter(
              ([key, value]) =>
                !fields.find((field) => field.key === key)?.secret ||
                value !== "",
            )
            .map(([key, value]) => {
              if (["smtp_port", "notify_connection_cooldown_s"].includes(key)) {
                if (value === "" || !Number.isFinite(Number(value)))
                  throw new Error("端口与提醒间隔必须为有效数字");
                return [key, Number(value)];
              }
              return [key, value];
            }),
        );
        await send("/api/settings/configuration", "PATCH", {
          revision: draft.value.revision,
          values: payload,
        });
        draft.reset();
        setCode("");
      },
      "设置已保存；邮件配置变更后请重新验证邮箱",
    );
  }
  return (
    <Page
      eyebrow="PREFERENCES / NOTIFICATIONS"
      title="提醒与通知"
      description="选择飞书或邮件接收运行提醒。邮件需验证收件邮箱；保存配置不会自动发送消息。"
    >
      <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card px-4 py-3 text-sm">
        <Mail className="size-4 text-primary" />
        <span>{text(state.recipient, "尚未配置目标邮箱")}</span>
        <Badge variant={verified ? "default" : "secondary"}>
          {verified ? "邮箱已验证" : "邮箱未验证"}
        </Badge>
        {verified && (
          <span className="text-muted-foreground">
            {state.can_notify ? "运行提醒已开启" : "开启运行提醒后生效"}
          </span>
        )}
      </div>
      {error && (
        <p role="alert" className="error-panel">
          {error}
        </p>
      )}
      <QueryState query={configuration}>
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <form onSubmit={(event) => void save(event)} className="space-y-5">
            <fieldset disabled={!!busy} className="space-y-5">
              <Card>
                <CardContent className="space-y-5">
                  <div>
                    <h2 className="font-semibold">1 · 邮件服务与目标邮箱</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      使用邮箱服务商提供的 SMTP
                      信息，密码通常需要填写专用授权码。
                    </p>
                  </div>
                  <div className="grid gap-5 sm:grid-cols-2">
                    {transportFields.map((field) => (
                      <FormField
                        key={field.name}
                        field={field}
                        value={
                          values[field.name] ??
                          (field.name === "smtp_security"
                            ? "ssl"
                            : field.name === "smtp_port"
                              ? 465
                              : "")
                        }
                        onChange={(value) => change(field.name, value)}
                      />
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    SMTP 凭据
                    {fields.find((field) => field.key === "smtp_password")
                      ?.configured
                      ? "已保存，页面不会回显"
                      : "尚未配置"}
                    。更改服务或邮箱后，原验证自动失效。
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="space-y-5">
                  <div>
                    <h2 className="font-semibold">飞书 / Lark 应用机器人</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      使用企业自建应用的机器人发送通知，直接调用 OpenAPI，无需
                      WebSocket
                      或事件订阅。请开启机器人能力及发送消息权限并发布应用。
                    </p>
                  </div>
                  <div className="grid gap-5 sm:grid-cols-2">
                    {larkFields.map((field) => (
                      <FormField
                        key={field.name}
                        field={field}
                        value={
                          values[field.name] ??
                          (field.name === "lark_domain"
                            ? "feishu"
                            : field.name === "lark_receive_id_type"
                              ? "chat_id"
                              : "")
                        }
                        onChange={(value) => change(field.name, value)}
                      />
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={draft.dirty || !!busy}
                      onClick={() =>
                        void act(
                          "lark-test",
                          () =>
                            send(
                              "/api/settings/notifications/lark/test",
                              "POST",
                            ),
                          "飞书测试消息已发送",
                        )
                      }
                    >
                      {busy === "lark-test" && (
                        <LoaderCircle className="size-4 animate-spin" />
                      )}
                      测试发送飞书消息
                    </Button>
                    <span className="text-xs text-muted-foreground">
                      {fields.find((field) => field.key === "lark_app_secret")
                        ?.configured
                        ? "密钥已保存，不会回显。"
                        : "尚未配置应用密钥。"}
                      {draft.dirty
                        ? "请先保存设置，再测试发送。"
                        : "仅点击测试按钮才会发送测试消息。"}
                    </span>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="space-y-5">
                  <div>
                    <h2 className="font-semibold">提醒内容</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      飞书按已保存的应用配置发送；邮件通过收件验证后才会投递。
                    </p>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    {ruleFields.map((field) => (
                      <FormField
                        key={field.name}
                        field={field}
                        value={values[field.name] ?? false}
                        onChange={(value) => change(field.name, value)}
                      />
                    ))}
                  </div>
                </CardContent>
              </Card>
            </fieldset>
            <div className="save-bar">
              <p className="text-sm text-muted-foreground">
                {draft.dirty
                  ? `${Object.keys(changes).length} 项修改尚未保存`
                  : "所有设置均已保存"}
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  disabled={!draft.dirty || !!busy}
                  onClick={() => draft.reset()}
                >
                  放弃修改
                </Button>
                <Button type="submit" disabled={!draft.dirty || !!busy}>
                  {busy === "save" ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : (
                    <Save className="size-4" />
                  )}
                  保存设置
                </Button>
              </div>
            </div>
          </form>
          <Card>
            <CardContent className="space-y-5">
              <div className="flex items-center gap-2">
                <ShieldCheck className="size-5 text-primary" />
                <h2 className="font-semibold">2 · 验证收件邮箱</h2>
              </div>
              <QueryState query={status}>
                <p className="text-sm leading-6 text-muted-foreground">
                  验证码发送到已保存的目标邮箱，十分钟内有效。验证码不会在页面或日志中显示。
                </p>
                {draft.dirty && (
                  <p className="text-sm text-amber-700 dark:text-amber-400">
                    请先保存修改，再发送或验证验证码。
                  </p>
                )}
                {verified ? (
                  <p className="flex items-center gap-2 text-sm text-primary">
                    <Check className="size-4" />
                    已通过后端验证
                  </p>
                ) : (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full"
                      disabled={
                        !!busy || draft.dirty || !state.recipient || resend > 0
                      }
                      onClick={() =>
                        void act(
                          "send",
                          async () => {
                            await send(
                              "/api/settings/notifications/email/verification-code",
                              "POST",
                            );
                          },
                          "验证码已发送，请检查收件箱或垃圾邮件",
                        )
                      }
                    >
                      {busy === "send" && (
                        <LoaderCircle className="size-4 animate-spin" />
                      )}
                      {resend > 0 ? `${resend} 秒后可重新发送` : "发送验证码"}
                    </Button>
                    <form
                      className="space-y-3"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void act(
                          "verify",
                          async () => {
                            await send(
                              "/api/settings/notifications/email/verify",
                              "POST",
                              { challenge_id: state.challenge_id, code },
                            );
                            setCode("");
                          },
                          "邮箱验证成功",
                        );
                      }}
                    >
                      <Label htmlFor="mail-code">邮箱验证码</Label>
                      <Input
                        id="mail-code"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        pattern="[0-9]{6}"
                        maxLength={6}
                        placeholder="六位数字"
                        value={code}
                        onChange={(event) =>
                          setCode(event.target.value.replace(/\D/g, ""))
                        }
                        disabled={!!busy || draft.dirty}
                      />
                      <Button
                        type="submit"
                        className="w-full"
                        disabled={
                          !!busy ||
                          draft.dirty ||
                          !state.challenge_id ||
                          Number(state.attempts_remaining || 0) <= 0 ||
                          code.length !== 6
                        }
                      >
                        {busy === "verify" && (
                          <LoaderCircle className="size-4 animate-spin" />
                        )}
                        验证邮箱
                      </Button>
                    </form>
                  </>
                )}
                {!!state.challenge_id && (
                  <p className="text-xs text-muted-foreground">
                    本次剩余尝试次数：{Number(state.attempts_remaining || 0)}
                  </p>
                )}
                {!!delivery.at && (
                  <p className="text-xs leading-5 text-muted-foreground">
                    最近运行邮件：
                    {time(
                      new Date(Number(delivery.at) * 1000).toISOString(),
                    )} ·{" "}
                    {delivery.ok
                      ? "已交给邮件服务器"
                      : text(delivery.error, "发送失败")}
                  </p>
                )}
              </QueryState>
              <Link
                className="text-xs text-primary underline underline-offset-4"
                to="/settings/configuration?group=notifications"
              >
                Webhook、磁盘阈值及全部通知参数
              </Link>
            </CardContent>
          </Card>
        </div>
      </QueryState>
    </Page>
  );
}
