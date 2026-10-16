import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Settings2,
  Trash2,
  FlaskConical,
  QrCode,
  ShieldCheck,
  Puzzle,
  Captions,
  Film,
  Radio,
  ArrowRight,
} from "lucide-react";
import { toast } from "sonner";
import { api, send, useAction, useApi, type Row } from "@/api/client";
import { useAuth } from "@/api/auth";
import { useDraft } from "@/lib/drafts";
import { obj, rows, text } from "@/lib/data";
import { labelFor } from "@/components/schema-fields";
import {
  Page,
  Empty,
  QueryState,
  Refresh,
  Status,
  FormDialog,
  FormField,
  serializeFields,
  ConfirmButton,
  DetailList,
  type FieldSpec,
} from "@/components/workbench";
import { PasswordButton } from "@/components/shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { download } from "./library";
import { Evidence } from "./review";

export function SettingsPage() {
  const auth = useAuth();
  const items = [
    [
      "/settings/configuration",
      "全部参数",
      "按分类查找运行参数，区分常用与高级设置。",
      Settings2,
    ],
    [
      "/settings/automation",
      "房间与运行设置",
      "自动化规则、端口及房间独立参数。",
      Radio,
    ],
    [
      "/settings/login",
      "Bilibili 账号",
      "网页扫码、浏览器登录与 Cookie 管理。",
      QrCode,
    ],
    [
      "/settings/llm",
      "大模型服务",
      "配置多个服务与失败回退，测试连接。",
      FlaskConical,
    ],
    ["/settings/plugins", "插件中心", "发现、启停插件并配置扩展能力。", Puzzle],
    [
      "/settings/subtitles",
      "字幕模板",
      "管理 ASS 样式，导入与导出字幕模板。",
      Captions,
    ],
    ["/settings/intros", "片头与片尾", "管理文字、时长、字体和背景。", Film],
  ] as const;
  return (
    <Page
      eyebrow="PREFERENCES"
      title="设置中心"
      description="按用途组织配置。保存前可核对变更，未提交的编辑会保留在当前工作台。"
      actions={<PasswordButton />}
    >
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {items.map(([to, name, description, Icon]) => (
          <Link
            to={to}
            key={to}
            className="group rounded-2xl border bg-card p-6 transition hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5"
          >
            <div className="mb-6 flex items-center justify-between">
              <span className="grid size-11 place-items-center rounded-xl bg-primary/8 text-primary">
                <Icon className="size-5" />
              </span>
              <ArrowRight className="size-4 text-muted-foreground transition group-hover:translate-x-1 group-hover:text-primary" />
            </div>
            <h2 className="font-semibold">{name}</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {description}
            </p>
          </Link>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        当前访问方式：
        {auth.mode === "session"
          ? "安全会话"
          : auth.mode === "basic"
            ? "账号认证"
            : "本机访问"}{" "}
        · {auth.username}
      </p>
    </Page>
  );
}

export function AutomationPage() {
  const [params] = useSearchParams();
  const room = params.get("room");
  const learning = useApi(
    `/api/rooms/${room}/threshold-learning`,
    10000,
    !!room,
  );
  const query = useApi("/api/settings", 15000);
  const cache = useQueryClient();
  return (
    <Page
      title="房间与运行设置"
      description="房间自动化开关和阈值在直播间卡片中单独设置；录制与转写的公共默认值在全部参数中配置。"
      actions={<Refresh refresh={query.refetch} />}
    >
      <div className="flex flex-wrap gap-3">
        <Button asChild>
          <Link to="/rooms">管理房间自动化</Link>
        </Button>
        <Button asChild variant="outline">
          <Link to="/settings/configuration">全部参数</Link>
        </Button>
      </div>
      {room && (
        <Card>
          <CardContent className="space-y-4">
            <h2 className="font-semibold">房间 #{room} · 阈值自学习</h2>
            <QueryState query={learning}>
              <Evidence value={learning.data} />
            </QueryState>
          </CardContent>
        </Card>
      )}
      <QueryState query={query}>
        <Card>
          <CardContent className="space-y-5">
            <h2 className="font-medium">启动端口</h2>
            <p className="text-sm leading-6 text-muted-foreground">
              console 和 Portable
              将它用作前端端口，重启后生效。分别运行前后端时，请同步核对 API
              监听端口与反向代理配置。
            </p>
            <DetailList
              values={Object.entries(obj(query.data))
                .filter(([key]) => /port|restart|upload/.test(key))
                .map(([key, value]) => ({
                  label: labelFor(key),
                  value:
                    typeof value === "object"
                      ? JSON.stringify(value)
                      : String(value),
                }))}
            />
            <FormDialog
              id="backend-port"
              title="修改启动端口"
              trigger={<Button variant="outline">设置端口</Button>}
              fields={[
                {
                  name: "web_port",
                  label: "启动端口",
                  type: "number",
                  min: 1,
                  max: 65535,
                  required: true,
                },
              ]}
              initial={{ web_port: obj(query.data).web_port || 8000 }}
              onSubmit={async (body) => {
                await send("/api/settings/port", "PATCH", body);
                await cache.invalidateQueries({ queryKey: ["api"] });
              }}
            />
          </CardContent>
        </Card>
      </QueryState>
    </Page>
  );
}

const providerFields: FieldSpec[] = [
  { name: "name", label: "服务名称" },
  {
    name: "base_url",
    label: "API 地址",
    required: true,
    placeholder: "https://api.example.com/v1",
  },
  { name: "model", label: "模型名称", required: true },
  {
    name: "api_key",
    label: "API 密钥",
    type: "password",
    description: "留空保留已保存的密钥。",
  },
  { name: "clear_api_key", label: "清除已保存密钥", type: "boolean" },
  { name: "enabled", label: "启用服务", type: "boolean" },
  {
    name: "priority",
    label: "优先级（较小的优先）",
    type: "number",
    required: true,
  },
  { name: "web_search_param", label: "联网搜索参数" },
  {
    name: "price_input_per_m",
    label: "每百万输入 Token 价格",
    type: "number",
    min: 0,
  },
  {
    name: "price_output_per_m",
    label: "每百万输出 Token 价格",
    type: "number",
    min: 0,
  },
];
function normalizedProviders(values: Row[]) {
  return values.map((value) => ({
    id: text(value.id, ""),
    ...serializeFields(value, providerFields),
  }));
}
export function LlmPage() {
  const query = useApi("/api/llm-providers", false);
  const draft = useDraft<Row[] | null>("llm-providers", null);
  const cache = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState<Row[]>([]);
  const providers: Row[] =
    draft.value ??
    rows(obj(query.data).providers).map((entry) => ({
      ...entry,
      api_key: "",
      clear_api_key: false,
    }));
  const update = (index: number, next: unknown, key: string) =>
    draft.update(
      providers.map((row, i) => (i === index ? { ...row, [key]: next } : row)),
    );
  async function save(test = false) {
    setBusy(true);
    setError("");
    try {
      const result = await send<Row>(
        test ? "/api/llm-providers/test" : "/api/llm-providers",
        test ? "POST" : "PUT",
        { providers: normalizedProviders(providers) },
      );
      if (test) setResults(rows(result.results));
      else {
        draft.reset();
        await cache.invalidateQueries({ queryKey: ["api"] });
        toast.success("服务配置已保存");
      }
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Page
      title="大模型服务"
      description="按优先级调用可用服务；密钥留空时保留原值。测试只验证草稿，不会保存配置。"
      actions={
        <>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void save(true)}
          >
            <FlaskConical className="size-4" />
            测试连接
          </Button>
          <Button disabled={busy || !draft.dirty} onClick={() => void save()}>
            保存全部服务
          </Button>
        </>
      }
    >
      <QueryState query={query}>
        <div className="space-y-5">
          {providers.map((provider, index) => (
            <Card key={index}>
              <CardContent>
                <div className="mb-5 flex justify-between">
                  <h2 className="font-medium">
                    {text(provider.name, `服务 ${index + 1}`)}
                    {provider.api_key_set ? (
                      <Badge variant="outline" className="ml-3">
                        密钥已配置
                      </Badge>
                    ) : null}
                  </h2>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      draft.update(providers.filter((_, i) => i !== index))
                    }
                  >
                    <Trash2 className="size-4" />
                    移除
                  </Button>
                </div>
                <fieldset disabled={busy} className="grid gap-4 md:grid-cols-2">
                  {providerFields.map((field) => (
                    <FormField
                      key={field.name}
                      field={field}
                      value={provider[field.name]}
                      onChange={(next) => update(index, next, field.name)}
                    />
                  ))}
                </fieldset>
              </CardContent>
            </Card>
          ))}
          {!providers.length && (
            <Empty
              title="还没有配置大模型服务"
              description="添加支持兼容接口的服务，启用摘要、高光分析与文案生成。"
            />
          )}
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              draft.update([
                ...providers,
                {
                  id: "",
                  name: "",
                  base_url: "",
                  model: "",
                  api_key: "",
                  enabled: true,
                  priority: 100,
                  price_input_per_m: 0,
                  price_output_per_m: 0,
                },
              ])
            }
          >
            <Plus className="size-4" />
            添加服务
          </Button>
          {draft.dirty && (
            <Button
              variant="ghost"
              onClick={() => draft.reset()}
              disabled={busy}
            >
              放弃全部修改
            </Button>
          )}
        </div>
      </QueryState>
      {error && (
        <p role="alert" className="error-panel">
          {error}；草稿已保留。
        </p>
      )}
      {results.length > 0 && (
        <Card>
          <CardContent className="space-y-4">
            {results.map((result, index) => (
              <div key={index} className="flex flex-wrap gap-3 text-sm">
                <Status value={result.ok ? "success" : "failed"} />
                <strong>{text(result.name || result.id)}</strong>
                <span className="text-muted-foreground">
                  {text(result.detail)}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </Page>
  );
}

const qrLabels: Record<string, string> = {
  idle: "准备好后申请二维码",
  starting: "正在申请二维码",
  scan: "等待扫描二维码",
  confirm: "已扫描，请在手机端确认",
  committing: "正在保存登录状态",
  validating: "正在验证凭据",
  done: "已登录成功",
  timeout: "二维码已过期",
  cancelled: "扫码已取消",
  error: "登录失败",
};
export function BilibiliLoginPage() {
  const cookie = useApi("/api/cookie-status", 10000);
  const current = useApi<Row>("/api/login/qrcode", false);
  const [task, setTask] = useState<Row | null>(null);
  const [browser, setBrowser] = useState<number | null>(null);
  const [browserOutcome, setBrowserOutcome] = useState("");
  const cache = useQueryClient();
  const action = useAction();
  const auth = useAuth();
  const active = task ?? current.data;
  const id = text(active?.task_id, "");
  const status = text(active?.status, "idle");
  const running = [
    "starting",
    "scan",
    "confirm",
    "validating",
    "committing",
  ].includes(status);
  const poll = useApi<Row>(`/api/login/qrcode/${id}`, 2000, !!id && running);
  const browserPoll = useApi<Row>(
    `/api/login/status?task_id=${browser}`,
    2000,
    browser !== null,
  );
  useEffect(() => {
    if (poll.data) {
      setTask(poll.data);
      if (poll.data.status === "done")
        void cache.invalidateQueries({
          queryKey: ["api", "/api/cookie-status"],
        });
    }
  }, [poll.data, cache]);
  useEffect(() => {
    if (browserPoll.data?.status === "done") {
      setBrowser(null);
      setBrowserOutcome("浏览器登录成功");
      void cache.invalidateQueries({ queryKey: ["api", "/api/cookie-status"] });
    } else if (
      browserPoll.data?.error ||
      browserPoll.data?.status === "not_found"
    ) {
      setBrowserOutcome(
        text(browserPoll.data.error, "浏览器登录任务已结束或不存在"),
      );
      setBrowser(null);
    }
  }, [browserPoll.data, cache]);
  const info = obj(cookie.data);
  return (
    <Page
      title="Bilibili 账号"
      description="推荐直接在网页扫码，服务器无需桌面。登录凭据只在后端保存。"
      actions={<Refresh refresh={cookie.refetch} />}
    >
      <QueryState query={cookie}>
        <div className="grid gap-5 xl:grid-cols-[1fr_1.1fr]">
          <Card>
            <CardContent className="space-y-5">
              <div className="flex items-center gap-3">
                <ShieldCheck className="size-5 text-primary" />
                <h2 className="font-semibold">账号状态</h2>
                <Status value={info.has_cookie ? "success" : "unavailable"} />
              </div>
              <p className="text-sm text-muted-foreground">
                {info.has_cookie
                  ? `已保存登录凭据 · UID: ${text(info.uid, "待校验")}`
                  : text(info.hint, "尚未保存登录凭据")}
              </p>
              <ConfirmButton
                destructive
                title="清除登录凭据？"
                description="后续取流与投稿将使用未登录状态。"
                onConfirm={() =>
                  action.mutateAsync({ path: "/api/login/clear" })
                }
              >
                清除 Cookie
              </ConfirmButton>
              <div className="space-y-4 border-t pt-5">
                <h3 className="text-sm font-medium">其他登录方式</h3>
                <Button
                  variant="outline"
                  disabled={action.isPending || browser !== null}
                  onClick={() =>
                    void action
                      .mutateAsync({ path: "/api/login" })
                      .then((result) => setBrowser(Number(obj(result).task_id)))
                      .catch(() => {})
                  }
                >
                  在服务器打开浏览器登录
                </Button>
                {browserOutcome && (
                  <p role="status" className="text-sm text-muted-foreground">
                    {browserOutcome}
                  </p>
                )}
                {browser !== null && (
                  <p role="status" className="text-sm text-muted-foreground">
                    {text(
                      browserPoll.data?.error || browserPoll.data?.status,
                      "等待浏览器启动",
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setBrowser(null)}
                    >
                      停止查看
                    </Button>
                  </p>
                )}
                <p className="text-xs leading-6 text-muted-foreground">
                  浏览器方式需要服务器具备桌面环境。手动 Cookie 可在
                  <Link
                    to="/settings/configuration?q=bilibili_cookie"
                    className="text-primary underline"
                  >
                    全部参数
                  </Link>
                  中配置。
                </p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex min-h-96 flex-col items-center justify-center gap-5 p-8">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <QrCode className="size-4 text-primary" />
                网页扫码登录
              </div>
              {typeof active?.qrcode === "string" &&
              active.qrcode.startsWith("data:image/svg+xml;base64,") ? (
                <img
                  alt="Bilibili 登录二维码"
                  width={216}
                  height={216}
                  src={active.qrcode}
                  className="rounded-2xl border bg-white p-4"
                />
              ) : (
                <div className="grid size-52 place-items-center rounded-2xl border border-dashed bg-muted/40">
                  <QrCode className="size-16 text-muted-foreground/30" />
                </div>
              )}
              <p role="status" className="text-sm font-medium">
                {qrLabels[status] || status}
              </p>
              {active?.error ? (
                <p
                  role="alert"
                  className="text-center text-sm text-destructive"
                >
                  {text(active.error)}
                </p>
              ) : null}
              {poll.isError && (
                <p className="text-sm text-destructive">
                  状态读取失败，任务仍保留。
                  <Button variant="link" onClick={() => void poll.refetch()}>
                    重试读取
                  </Button>
                </p>
              )}
              <div className="flex gap-3">
                <Button
                  disabled={!auth.authenticated || action.isPending || running}
                  onClick={() =>
                    void action
                      .mutateAsync({ path: "/api/login/qrcode" })
                      .then((value) => setTask(obj(value)))
                      .catch(() => {})
                  }
                >
                  {status === "idle" ? "申请二维码" : "重新申请"}
                </Button>
                {running && (
                  <Button
                    variant="outline"
                    disabled={action.isPending}
                    onClick={() =>
                      void action
                        .mutateAsync({ path: `/api/login/qrcode/${id}/cancel` })
                        .then((value) => setTask(obj(value)))
                        .catch(() => {})
                    }
                  >
                    取消扫码
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                二维码过期后手动刷新，不会自动创建新任务。
              </p>
            </CardContent>
          </Card>
        </div>
      </QueryState>
    </Page>
  );
}

export function PluginsPage() {
  const query = useApi("/api/plugins", false);
  const action = useAction();
  return (
    <Page
      title="插件中心"
      description="插件在服务端运行。启用前请确认来源，插件异常会在卡片中显示。"
      actions={
        <Button
          variant="outline"
          disabled={action.isPending}
          onClick={() => action.mutate({ path: "/api/plugins/refresh" })}
        >
          重新扫描
        </Button>
      }
    >
      <QueryState query={query}>
        {rows(obj(query.data).plugins).length ? (
          <div className="grid gap-4 md:grid-cols-2">
            {rows(obj(query.data).plugins).map((plugin) => (
              <Card key={text(plugin.id)}>
                <CardContent className="space-y-4">
                  <div className="flex justify-between">
                    <h2 className="font-semibold">
                      {text(plugin.name || plugin.id)}
                    </h2>
                    <Status value={plugin.enabled ? "enabled" : "disabled"} />
                  </div>
                  <p className="text-sm leading-6 text-muted-foreground">
                    {text(plugin.description, "暂无描述")}
                  </p>
                  <div className="flex gap-2">
                    <Badge variant="secondary">{text(plugin.version)}</Badge>
                    {Array.isArray(plugin.capabilities)
                      ? plugin.capabilities.map((cap) => (
                          <Badge variant="outline" key={String(cap)}>
                            {text(cap)}
                          </Badge>
                        ))
                      : null}
                  </div>
                  {plugin.error ? (
                    <p className="error-panel text-xs">{text(plugin.error)}</p>
                  ) : null}
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      disabled={action.isPending}
                      onClick={() =>
                        action.mutate({
                          path: `/api/plugins/${encodeURIComponent(text(plugin.id))}`,
                          method: "PATCH",
                          body: { enabled: !plugin.enabled },
                        })
                      }
                    >
                      {plugin.enabled ? "停用" : "启用"}
                    </Button>
                    {Boolean(plugin.enabled && plugin.settings_page) && (
                      <Button asChild variant="ghost">
                        <Link
                          to={`/plugins/${encodeURIComponent(text(plugin.id))}/settings`}
                        >
                          插件设置
                        </Link>
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Empty
            title="没有发现插件"
            description="将插件放入后端插件目录，然后重新扫描。"
          />
        )}
      </QueryState>
    </Page>
  );
}
export function PluginSettingsPage() {
  const { id = "" } = useParams();
  const path = `/api/plugins/${encodeURIComponent(id)}/settings`;
  const query = useApi(path, false);
  const cache = useQueryClient();
  const fields = rows(obj(query.data).fields);
  const specs: FieldSpec[] = fields.map((field) => ({
    name: text(field.key),
    label: text(field.label || field.title, text(field.key)),
    type:
      field.kind === "password"
        ? "password"
        : field.kind === "boolean"
          ? "boolean"
          : field.kind === "number" || field.kind === "integer"
            ? "number"
            : field.kind === "textarea"
              ? "textarea"
              : "text",
    description:
      field.kind === "password" && field.configured
        ? `${text(field.description, "")} 已配置，留空保留。`
        : text(field.description, ""),
    required:
      !!field.required && !(field.kind === "password" && field.configured),
    min: typeof field.minimum === "number" ? field.minimum : undefined,
    max: typeof field.maximum === "number" ? field.maximum : undefined,
    options:
      field.kind === "select" &&
      Array.isArray(field.choices) &&
      field.choices.length
        ? field.choices.map((option) =>
            typeof option === "object"
              ? {
                  label: text(obj(option).label),
                  value: text(obj(option).value),
                }
              : { label: text(option), value: text(option) },
          )
        : undefined,
  }));
  return (
    <Page
      title={`${text(obj(obj(query.data).plugin).name, id)} · 插件设置`}
      description="敏感字段留空保留原值。字段由插件声明并由后端校验。"
    >
      <QueryState query={query}>
        <Card>
          <CardContent>
            <FormDialog
              id={`plugin-${id}`}
              title="编辑插件设置"
              trigger={<Button>编辑设置</Button>}
              fields={specs}
              initial={Object.fromEntries(
                fields.map((field) => [text(field.key), field.value]),
              )}
              onSubmit={async (values) => {
                await send(path, "PATCH", { values });
                await cache.invalidateQueries({ queryKey: ["api", path] });
              }}
            />
            <DetailList
              values={fields.map((field) => ({
                label: text(field.label || field.key),
                value:
                  field.kind === "password"
                    ? field.configured
                      ? "已配置"
                      : "未配置"
                    : String(field.value ?? "未设置"),
              }))}
            />
          </CardContent>
        </Card>
      </QueryState>
    </Page>
  );
}

export function TemplatesPage({ intro = false }: { intro?: boolean }) {
  const path = intro ? "/api/intro-templates" : "/api/templates";
  const query = useApi(path, false);
  const action = useAction();
  const [selected, setSelected] = useState<number | null>(null);
  const detail = useApi<Row>(`${path}/${selected}`, false, selected !== null);
  const cache = useQueryClient();
  const fields: FieldSpec[] = Object.entries(detail.data || {})
    .filter(([key]) => !["id", "created_at", "updated_at"].includes(key))
    .map(([key, value]) => ({
      name: key,
      label: labelFor(key),
      type:
        typeof value === "boolean"
          ? "boolean"
          : typeof value === "number"
            ? "number"
            : key.endsWith("_text") || key === "description"
              ? "textarea"
              : "text",
      required: key === "name",
    }));
  return (
    <Page
      title={intro ? "片头与片尾" : "字幕模板"}
      description={
        intro
          ? "为切片添加可复用的开场与收尾。文字支持后端提供的变量替换。"
          : "管理 ASS 字幕样式，支持完整字体、颜色、边距与显示时间参数。"
      }
      actions={
        <>
          <Button
            disabled={action.isPending}
            onClick={() =>
              void action
                .mutateAsync({ path })
                .then((result) => setSelected(Number(obj(result).id)))
                .catch(() => {})
            }
          >
            <Plus className="size-4" />
            新建模板
          </Button>
          {!intro && (
            <label className="inline-flex cursor-pointer items-center rounded-md border bg-card px-4 py-2 text-sm">
              导入 ASS
              <input
                type="file"
                accept=".ass"
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (!file) return;
                  if (file.size > 1048576) {
                    toast.error("ASS 文件不能超过 1 MiB");
                    return;
                  }
                  const form = new FormData();
                  form.append("file", file);
                  void api("/api/templates/import/ass", {
                    method: "POST",
                    body: form,
                  })
                    .then(() => cache.invalidateQueries({ queryKey: ["api"] }))
                    .catch((error: Error) => toast.error(error.message));
                }}
              />
            </label>
          )}
        </>
      }
    >
      <QueryState query={query}>
        {rows(query.data).length ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {rows(query.data).map((template) => (
              <Card key={text(template.id)}>
                <CardContent className="space-y-4">
                  <div className="template-preview">
                    <p
                      style={{
                        fontFamily: text(
                          template.font_name || template.intro_font_name,
                          "sans-serif",
                        ),
                      }}
                    >
                      {intro
                        ? text(template.intro_text, "精彩即将开始")
                        : "每一个片刻，都值得被看见"}
                    </p>
                  </div>
                  <h2 className="font-semibold">{text(template.name)}</h2>
                  {template.is_default ? <Badge>默认模板</Badge> : null}
                  <p className="text-xs text-muted-foreground">
                    {text(
                      template.description || template.font_name,
                      "自定义片头 / 片尾",
                    )}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setSelected(Number(template.id))}
                    >
                      查看与编辑
                    </Button>
                    {!intro && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          void download(
                            `${path}/${template.id}/export`,
                            `subtitle-${template.id}.ass`,
                          ).catch((error: Error) => toast.error(error.message))
                        }
                      >
                        导出 ASS
                      </Button>
                    )}
                    <ConfirmButton
                      title="删除模板？"
                      description="已有成品不会改变，后续渲染请重新选择模板。"
                      destructive
                      onConfirm={() =>
                        action.mutateAsync({
                          path: `${path}/${template.id}`,
                          method: "DELETE",
                        })
                      }
                    >
                      删除
                    </ConfirmButton>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Empty
            title="还没有模板"
            description="创建一个模板，为后续切片保持一致的视觉风格。"
          />
        )}
      </QueryState>
      {selected !== null && (
        <Card>
          <CardContent className="space-y-4">
            <h2 className="font-semibold">模板 #{selected}</h2>
            <QueryState query={detail}>
              <FormDialog
                key={selected}
                id={`template-${intro}-${selected}`}
                title="编辑模板全部参数"
                trigger={<Button>编辑全部参数</Button>}
                fields={fields}
                initial={detail.data}
                onSubmit={async (body) => {
                  await send(`${path}/${selected}`, "PUT", body);
                  await cache.invalidateQueries({ queryKey: ["api"] });
                }}
              />
              <DetailList
                values={fields.map((field) => ({
                  label: field.label,
                  value: String(detail.data?.[field.name] ?? ""),
                }))}
              />
            </QueryState>
            <Button variant="ghost" onClick={() => setSelected(null)}>
              收起详情
            </Button>
          </CardContent>
        </Card>
      )}
    </Page>
  );
}
