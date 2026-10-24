import {
  createContext,
  lazy,
  Suspense,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { Popover } from "radix-ui";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Clapperboard,
  LoaderCircle,
  Sparkles,
  X,
} from "lucide-react";
import { useAuth } from "@/api/auth";
import { useApi, type Row } from "@/api/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { OnboardingAsr } from "@/components/onboarding-asr";
import { hasDrafts, useDraft } from "@/lib/drafts";
import { obj, rows, text } from "@/lib/data";
import {
  onboardingKey,
  readIntro,
  setupSteps,
  subscribeIntro,
  tourSteps,
  writeIntro,
  type IntroStage,
} from "@/features/onboarding";

const BiliSetup = lazy(() =>
  import("@/pages/admin").then((module) => ({
    default: module.BilibiliLoginPage,
  })),
);
const LlmSetup = lazy(() =>
  import("@/pages/admin").then((module) => ({ default: module.LlmPage })),
);
const IntroContext = createContext({
  stage: "done" as IntroStage,
  open: () => {},
  finish: () => {},
  setStage: (_stage: IntroStage) => {},
});
export const useOnboarding = () => useContext(IntroContext);

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  return auth.role === "admin" ? (
    <AdminOnboarding key={onboardingKey(auth.mode, auth.username)}>
      {children}
    </AdminOnboarding>
  ) : (
    children
  );
}
function AdminOnboarding({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const key = onboardingKey(auth.mode, auth.username);
  const stage = useSyncExternalStore(subscribeIntro, () => readIntro(key));
  const setStage = (next: IntroStage) => writeIntro(key, next);
  const [busy, setBusy] = useState(false);
  const asr = useDraft<Row>("onboarding-asr", {});
  const llm = useDraft<Row | null>("model-configuration", null);
  const wizard = stage.startsWith("setup:");
  const step = Number(stage.split(":")[1] || 0);
  const dirty = (step === 2 && asr.dirty) || (step === 3 && llm.dirty);
  const blocked = busy || dirty;
  const finish = () => {
    setStage("done");
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLButtonElement>('[aria-label="重新打开使用引导"]')
        ?.focus(),
    );
  };
  useEffect(() => {
    const leave = (event: BeforeUnloadEvent) => {
      if (wizard && hasDrafts()) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", leave);
    return () => {
      window.removeEventListener("beforeunload", leave);
    };
  }, [wizard]);
  return (
    <IntroContext.Provider
      value={{ stage, open: () => setStage("setup:0"), finish, setStage }}
    >
      {wizard ? (
        <div className="grid min-h-dvh place-items-center bg-gradient-to-br from-primary/10 via-background to-muted/40">
          <div className="flex items-center gap-3 text-xl font-semibold text-primary">
            <Clapperboard />
            BiliLiveCut
          </div>
        </div>
      ) : (
        children
      )}
      <Dialog
        open={wizard && auth.authenticated}
        onOpenChange={(open) => {
          if (!open && !blocked) finish();
        }}
      >
        <DialogContent
          className="flex max-h-[90dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl"
          showCloseButton={false}
          onInteractOutside={(event) => event.preventDefault()}
          onEscapeKeyDown={(event) => {
            if (blocked) event.preventDefault();
          }}
        >
          <DialogHeader className="border-b bg-primary/5 px-6 py-5 text-left sm:px-8">
            <div className="mb-3 flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-xs font-medium tracking-wide text-primary">
                <Sparkles className="size-4" />
                BILILIVECUT · 开始之前
              </span>
              <span className="text-xs text-muted-foreground">
                {step + 1} / {setupSteps.length}
              </span>
            </div>
            <DialogTitle className="text-2xl">{setupSteps[step]}</DialogTitle>
            <DialogDescription>
              {
                [
                  "你好，很高兴认识你。花几分钟，准备好你的第一个高光工作台。",
                  "后台登录已经完成。这一步连接 Bilibili 账号，用于平台相关功能。",
                  "先让工作台听懂视频中的语音。",
                  "为文字理解、高光分析与总结连接大模型服务。",
                  "不必一次配置完所有选项，随时可以回来继续调整。",
                ][step]
              }
            </DialogDescription>
            <ol className="mt-4 flex gap-1.5" aria-label="初次使用进度">
              {setupSteps.map((label, index) => (
                <li
                  key={label}
                  aria-label={label}
                  aria-current={step === index ? "step" : undefined}
                  className={`h-1 flex-1 rounded-full ${index <= step ? "bg-primary" : "bg-primary/15"}`}
                />
              ))}
            </ol>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto p-6 sm:p-8">
            <Suspense
              fallback={
                <p role="status" className="flex items-center gap-2 py-12">
                  <LoaderCircle className="size-4 animate-spin" />
                  正在准备配置…
                </p>
              }
            >
              {step === 0 && (
                <div className="space-y-6">
                  <div className="rounded-2xl bg-primary/5 p-6">
                    <h2 className="text-xl font-semibold">从录播到粗剪切片</h2>
                    <p className="mt-3 text-sm leading-7 text-muted-foreground">
                      录制直播或导入录播，把语音转成文字，寻找高光，再由你审核和生成切片。你也可以只使用其中一部分功能。
                    </p>
                    <div className="mt-5 flex flex-wrap items-center gap-2 text-sm">
                      {[
                        "录制 / 导入",
                        "ASR 转写",
                        "高光分析",
                        "审片 / 成片",
                      ].map((label) => (
                        <span
                          key={label}
                          className="rounded-lg border bg-background px-3 py-2"
                        >
                          {label}
                        </span>
                      ))}
                    </div>
                  </div>
                  <p className="text-sm leading-7 text-muted-foreground">
                    接下来可以连接 B
                    站账号、选择转写方式并配置大模型。已有设置会保留，只有你点击保存才会修改配置；引导不会自动开始录制、下载模型或调用付费模型。
                  </p>
                  <Button variant="outline" onClick={() => setStage("tour:0")}>
                    只看功能导览
                    <ArrowRight className="size-4" />
                  </Button>
                </div>
              )}
              {step === 1 && <BiliSetup embedded />}
              {step === 2 && <OnboardingAsr onBusy={setBusy} />}
              {step === 3 && (
                <>
                  <p className="mb-5 text-sm leading-7 text-muted-foreground">
                    LLM 和 ASR
                    是两种服务，地址与模型名称未必相同。已有服务会保留。点击“测试连接”会向已填写的服务发送小请求，可能产生少量费用；保存不会自动测试。
                  </p>
                  <LlmSetup embedded onBusy={setBusy} />
                </>
              )}
              {step === 4 && <SetupSummary />}
            </Suspense>
          </div>
          <div className="space-y-3 border-t bg-muted/20 px-6 py-4 sm:px-8">
            {blocked && (
              <p role="status" className="text-xs text-muted-foreground">
                {busy
                  ? "正在处理，请稍候。"
                  : "有未保存的修改，请先保存或放弃本步修改后继续。"}
              </p>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button variant="ghost" disabled={blocked} onClick={finish}>
                稍后再说
              </Button>
              <div className="flex gap-2">
                {step > 0 && (
                  <Button
                    variant="outline"
                    disabled={blocked}
                    onClick={() => setStage(`setup:${step - 1}`)}
                  >
                    <ArrowLeft className="size-4" />
                    上一步
                  </Button>
                )}
                <Button
                  disabled={blocked}
                  onClick={() =>
                    setStage(
                      step === setupSteps.length - 1
                        ? "tour:0"
                        : `setup:${step + 1}`,
                    )
                  }
                >
                  {step === setupSteps.length - 1
                    ? "看看工作台怎么用"
                    : "下一步"}
                  <ArrowRight className="size-4" />
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </IntroContext.Provider>
  );
}
function SetupSummary() {
  const cookie = useApi("/api/cookie-status", false);
  const config = useApi("/api/settings/configuration", false);
  const llm = useApi("/api/model-configuration", false);
  const engine = rows(obj(config.data).fields).find(
    (field) => field.key === "asr_primary",
  )?.value;
  const labels: Record<string, string> = {
    openai_compatible: "远程 API",
    funasr_nano: "本地 FunASR Nano",
    paraformer: "本地 Paraformer",
    whisper: "本地 Whisper",
  };
  return (
    <div className="space-y-5">
      <h2 className="text-lg font-semibold">你的工作台已经可以开始探索了</h2>
      <ul className="space-y-3">
        {[
          [
            "B 站账号",
            cookie.isError
              ? "读取失败，请到账号设置重试"
              : cookie.isPending
                ? "正在读取…"
                : obj(cookie.data).has_cookie
                  ? "已保存登录凭据"
                  : "暂未配置，可稍后登录",
          ],
          [
            "ASR 转写",
            config.isError
              ? "读取失败，请到语音转写设置重试"
              : config.isPending
                ? "正在读取…"
                : text(labels[String(engine)], "尚未选择"),
          ],
          [
            "大模型服务",
            llm.isError
              ? "读取失败，请到大模型服务重试"
              : llm.isPending
                ? "正在读取…"
                : `${rows(obj(llm.data).connections).filter((item) => item.enabled).length} 个启用连接，${Object.values(obj(obj(llm.data).active_counts)).reduce<number>((total, value) => total + Number(value || 0), 0)} 条启用路由`,
          ],
        ].map(([label, value]) => (
          <li
            key={label}
            className="flex items-center gap-3 rounded-xl border p-4 text-sm"
          >
            <Check className="size-4 shrink-0 text-primary" />
            <span className="font-medium">{label}</span>
            <span className="ml-auto text-right text-muted-foreground">
              {value}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-sm leading-7 text-muted-foreground">
        这些是已保存的配置，不代表模型已安装或接口已经连通。你可以先导入一小段有权处理的录播，检查转写和切片效果，再逐步开启自动化。
      </p>
    </div>
  );
}

export function TourTarget({
  path,
  children,
}: {
  path: string;
  children: ReactNode;
}) {
  const intro = useOnboarding();
  const auth = useAuth();
  const ref = useRef<HTMLDivElement>(null);
  const [wide, setWide] = useState(() => window.innerWidth >= 1024);
  const index = Number(intro.stage.split(":")[1]);
  const active =
    auth.authenticated &&
    intro.stage.startsWith("tour:") &&
    tourSteps[index]?.path === path;
  useEffect(() => {
    if (!active) return;
    const resize = () => setWide(window.innerWidth >= 1024);
    resize();
    ref.current?.scrollIntoView({ block: "nearest" });
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [active]);
  if (!active) return children;
  const step = tourSteps[index];
  return (
    <Popover.Root
      open
      onOpenChange={(open) => {
        if (!open) intro.finish();
      }}
      modal
    >
      <Popover.Anchor asChild>
        <div
          ref={ref}
          className="rounded-lg ring-2 ring-primary ring-offset-2 ring-offset-[#152237]"
        >
          {children}
        </div>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          side={wide ? "right" : "bottom"}
          updatePositionStrategy="always"
          align="start"
          sideOffset={16}
          collisionPadding={16}
          className="z-[70] w-[min(320px,calc(100vw-32px))] rounded-xl border bg-popover p-5 text-popover-foreground shadow-2xl outline-none"
          aria-labelledby={`tour-${index}-title`}
          aria-describedby={`tour-${index}-body`}
          onInteractOutside={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          <div className="mb-3 flex items-center justify-between gap-3">
            <span className="text-xs text-primary">
              功能导览 · {index + 1} / {tourSteps.length}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label="结束功能导览"
              onClick={intro.finish}
            >
              <X className="size-4" />
            </Button>
          </div>
          <h2 id={`tour-${index}-title`} className="font-semibold">
            {step.title}
          </h2>
          <p
            id={`tour-${index}-body`}
            className="mt-2 text-sm leading-7 text-muted-foreground"
          >
            {step.body}
          </p>
          <div className="mt-5 flex justify-between gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={!index}
              onClick={() => intro.setStage(`tour:${index - 1}`)}
            >
              上一步
            </Button>
            <Button
              size="sm"
              onClick={() =>
                index === tourSteps.length - 1
                  ? intro.finish()
                  : intro.setStage(`tour:${index + 1}`)
              }
            >
              {index === tourSteps.length - 1 ? "开始使用" : "下一个"}
              <ArrowRight className="size-4" />
            </Button>
          </div>
          <Popover.Arrow className="fill-popover" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
