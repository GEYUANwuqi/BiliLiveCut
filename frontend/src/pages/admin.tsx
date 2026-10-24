import { useEffect, useState, type ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Trash2,
  FlaskConical,
  QrCode,
  ShieldCheck,
  ArrowRight,
  Search,
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
import { Input } from "@/components/ui/input";
import { settingsCatalog } from "@/features/settings-catalog";
import { createLlmProvider, llmPresets } from "@/features/llm-presets";

export function SettingsPage() {
  const auth = useAuth();
  const [search, setSearch] = useState("");
  const sections = settingsCatalog
    .map((section) => ({
      ...section,
      items: section.items.filter((item) =>
        `${item.label} ${item.description} ${section.title}`
          .toLowerCase()
          .includes(search.trim().toLowerCase()),
      ),
    }))
    .filter((section) => section.items.length);
  return (
    <Page
      eyebrow="PREFERENCES"
      title="设置中心"
      description="按使用场景选择设置，或搜索你想调整的功能。每个分类都直达对应参数。"
      actions={<PasswordButton />}
    >
      <div className="relative max-w-2xl">
        <Search className="absolute top-3 left-3 size-4 text-muted-foreground" />
        <Input
          aria-label="搜索设置功能"
          className="h-11 bg-card pl-10"
          placeholder="想调整什么？例如：邮箱、重连、字幕、模型…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      <div className="grid items-start gap-8 xl:grid-cols-[190px_1fr]">
        <nav
          aria-label="设置分类"
          className="flex flex-wrap gap-2 xl:sticky xl:top-6 xl:flex-col"
        >
          {sections.map((section) => (
            <a
              href={`#settings-${section.title}`}
              key={section.title}
              className="rounded-lg px-3 py-2 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              {section.title}
              <span className="ml-2 text-xs">{section.items.length}</span>
            </a>
          ))}
        </nav>
        <div className="space-y-9">
          {sections.map((section, index) => (
            <section
              id={`settings-${section.title}`}
              key={section.title}
              className="scroll-mt-6 space-y-4"
            >
              <div>
                <p className="text-[10px] font-medium tracking-widest text-primary">
                  0{index + 1}
                </p>
                <h2 className="mt-1 text-lg font-semibold">{section.title}</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {section.description}
                </p>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                {section.items.map((item) => (
                  <Link
                    to={item.to}
                    key={item.to}
                    className="group flex items-start justify-between gap-4 rounded-xl border bg-card p-5 transition hover:border-primary/40 hover:bg-primary/3"
                  >
                    <div>
                      <h3 className="font-medium">{item.label}</h3>
                      <p className="mt-2 text-sm leading-6 text-muted-foreground">
                        {item.description}
                      </p>
                    </div>
                    <ArrowRight className="mt-1 size-4 shrink-0 text-muted-foreground transition group-hover:translate-x-1 group-hover:text-primary" />
                  </Link>
                ))}
              </div>
            </section>
          ))}
          {!sections.length && (
            <Empty
              title="没有匹配的设置"
              description="换个关键词，或清空搜索查看全部分类。"
            />
          )}
        </div>
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
function SetupPanel({
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-5">
      <p className="text-sm leading-7 text-muted-foreground">{description}</p>
      <div className="flex flex-wrap gap-2">{actions}</div>
      {children}
    </div>
  );
}

export function LlmPage({
  embedded = false,
  onBusy,
}: { embedded?: boolean; onBusy?: (busy: boolean) => void } = {}) {
  const query = useApi("/api/llm-providers", false);
  const draft = useDraft<Row[] | null>("llm-providers", null);
  const cache = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState<Row[]>([]);
  const [presetId, setPresetId] = useState("custom");
  const preset = llmPresets.find((entry) => entry.id === presetId);
  useEffect(() => {
    onBusy?.(busy);
    return () => onBusy?.(false);
  }, [busy, onBusy]);
  const Frame = embedded ? SetupPanel : Page;
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
    <Frame
      title="大模型服务"
      description="按优先级调用可用服务；密钥留空时保留原值。测试只验证草稿，不会保存配置；会实际调用服务并计费，每个服务最多两次请求，每次生成上限为 4096 token（含思考）。"
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
          <Card>
            <CardContent className="space-y-4">
              <h2 className="font-medium">添加大模型服务</h2>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="min-w-0 flex-1">
                  <FormField
                    field={{
                      name: "llm_preset",
                      label: "服务商预设",
                      options: [
                        { value: "custom", label: "自定义 OpenAI 兼容服务" },
                        ...llmPresets.map((entry) => ({
                          value: entry.id,
                          label: entry.name,
                        })),
                      ],
                    }}
                    value={presetId}
                    disabled={busy}
                    onChange={(next) => setPresetId(String(next))}
                  />
                </div>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    draft.update([...providers, createLlmProvider(preset)]);
                    setResults([]);
                  }}
                >
                  <Plus className="size-4" />
                  添加服务
                </Button>
              </div>
              {preset ? (
                <div className="space-y-2 text-sm text-muted-foreground">
                  <p className="break-all font-mono text-xs">
                    {preset.baseUrl}
                  </p>
                  <p>{preset.note}</p>
                  <a
                    href={preset.docsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary underline underline-offset-4"
                  >
                    {preset.name}官方接入文档
                  </a>
                </div>
              ) : null}
              <p className="text-xs leading-6 text-muted-foreground">
                预设会填入名称、API 地址和已有的模型示例，添加后均可修改。
                模型权限和价格以平台控制台为准，密钥需自行填写。添加不会保存或发送请求。
              </p>
            </CardContent>
          </Card>
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
                  {providerFields
                    .filter(
                      (field) =>
                        !embedded ||
                        ["name", "base_url", "model", "api_key"].includes(
                          field.name,
                        ),
                    )
                    .map((field) => (
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
    </Frame>
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
export function BilibiliLoginPage({
  embedded = false,
}: { embedded?: boolean } = {}) {
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
  const Frame = embedded ? SetupPanel : Page;
  return (
    <Frame
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
              {!embedded && (
                <>
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
                          .then((result) =>
                            setBrowser(Number(obj(result).task_id)),
                          )
                          .catch(() => {})
                      }
                    >
                      在服务器打开浏览器登录
                    </Button>
                    {browserOutcome && (
                      <p
                        role="status"
                        className="text-sm text-muted-foreground"
                      >
                        {browserOutcome}
                      </p>
                    )}
                    {browser !== null && (
                      <p
                        role="status"
                        className="text-sm text-muted-foreground"
                      >
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
                </>
              )}
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
    </Frame>
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
