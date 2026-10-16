import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  Clapperboard,
  ArrowRight,
  LoaderCircle,
  ShieldCheck,
  RefreshCw,
} from "lucide-react";
import { bootAuth, login, useAuth } from "@/api/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

function LoginForm() {
  const auth = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      await login(
        String(data.get("username")),
        String(data.get("password")),
        String(data.get("code") || ""),
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "登录失败");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={(event) => void submit(event)} className="space-y-5">
      <fieldset disabled={busy} className="space-y-5">
        {auth.setup_required && (
          <div className="space-y-2">
            <Label htmlFor="setup-code">一次性初始化码</Label>
            <Input
              id="setup-code"
              name="code"
              required
              autoComplete="off"
              placeholder="从当前服务启动日志中获取"
            />
            <p className="text-xs text-muted-foreground">
              初始化后使用管理员密码登录，初始化码不作为日常密码。
            </p>
          </div>
        )}
        <div className="space-y-2">
          <Label htmlFor="admin-username">账号</Label>
          <Input
            id="admin-username"
            name="username"
            defaultValue={
              auth.username && auth.username !== "本机管理员"
                ? auth.username
                : "admin"
            }
            autoComplete="username"
            required
            maxLength={128}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="admin-password">
            {auth.setup_required ? "设置管理员密码" : "密码"}
          </Label>
          <Input
            id="admin-password"
            name="password"
            type="password"
            autoComplete={
              auth.setup_required ? "new-password" : "current-password"
            }
            required
            minLength={auth.setup_required ? 12 : undefined}
            maxLength={auth.setup_required ? 128 : 1024}
            placeholder={
              auth.setup_required ? "12–128 个字符" : "输入当前部署的管理员密码"
            }
          />
        </div>
      </fieldset>
      {(error || auth.error) && (
        <div className="error-panel text-sm" role="alert">
          {error || auth.error}
        </div>
      )}
      <Button type="submit" disabled={busy} className="h-11 w-full">
        {busy ? <LoaderCircle className="size-4 animate-spin" /> : null}
        {auth.setup_required ? "初始化并登录" : "进入工作台"}
        <ArrowRight className="size-4" />
      </Button>
    </form>
  );
}

export function SessionBoundary({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    void bootAuth();
  }, []);
  useEffect(() => {
    if (auth.authenticated) setEntered(true);
    else document.querySelectorAll("video").forEach((video) => video.pause());
  }, [auth.authenticated]);
  if (!auth.ready)
    return (
      <div className="grid min-h-dvh place-items-center bg-background">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <LoaderCircle className="size-5 animate-spin text-primary" />
          正在连接工作台…
        </div>
      </div>
    );
  if (!auth.authenticated && !entered)
    return (
      <main className="grid min-h-dvh lg:grid-cols-2">
        <section className="login-art relative hidden overflow-hidden bg-[#101928] p-14 text-white lg:flex lg:flex-col lg:justify-between">
          <div className="relative z-10 flex items-center gap-3 text-lg font-semibold">
            <div className="brand-symbol">
              <Clapperboard className="size-5" />
            </div>
            BiliLiveCut
          </div>
          <div className="relative z-10 max-w-lg">
            <p className="mb-6 text-xs tracking-[0.3em] text-sky-300">
              YOUR HIGHLIGHT WORKSPACE
            </p>
            <h1 className="text-5xl leading-tight font-medium tracking-tight">
              从录播，
              <br />
              到值得留下的片刻。
            </h1>
            <p className="mt-7 max-w-sm text-base leading-8 text-slate-400">
              录制、转写、寻找高光与人工审核。
              <br />
              在一个安静有序的工作台里，完成你的粗剪。
            </p>
            <div className="mt-12 flex items-end gap-1.5" aria-hidden="true">
              {Array.from({ length: 42 }, (_, index) => (
                <span
                  key={index}
                  className="w-1.5 rounded-full bg-sky-400/50"
                  style={{
                    height: `${12 + Math.abs(Math.sin(index * 0.71)) * (24 + Math.sin(index * 0.22) * 35)}px`,
                  }}
                />
              ))}
            </div>
          </div>
          <p className="relative z-10 text-xs text-slate-500">
            BiliLiveCut · 录播与高光切片工作台
          </p>
        </section>
        <section className="flex items-center justify-center bg-background px-6 py-16">
          <div className="w-full max-w-sm">
            <div className="mb-10 flex items-center gap-2 text-sm font-medium text-primary lg:hidden">
              <Clapperboard className="size-5" />
              BiliLiveCut
            </div>
            <div className="mb-8">
              <div className="mb-5 inline-flex rounded-xl border bg-muted p-3">
                <ShieldCheck className="size-5 text-primary" />
              </div>
              <h2 className="text-2xl font-semibold tracking-tight">
                {auth.setup_required ? "设置你的工作台" : "欢迎回来"}
              </h2>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                {auth.setup_required
                  ? "首次使用，请先创建管理员密码。"
                  : "使用部署时设置的后台账号登录。Bilibili 扫码登录在工作台内完成。"}
              </p>
            </div>
            <LoginForm />
            {auth.error && (
              <Button
                variant="ghost"
                className="mt-4 w-full"
                onClick={() => location.reload()}
              >
                <RefreshCw className="size-4" />
                重新连接服务
              </Button>
            )}
          </div>
        </section>
      </main>
    );
  return (
    <>
      <div inert={!auth.authenticated || undefined}>{children}</div>
      <Dialog open={!auth.authenticated}>
        <DialogContent
          showCloseButton={false}
          onInteractOutside={(event) => event.preventDefault()}
          onEscapeKeyDown={(event) => event.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>重新登录，继续当前工作</DialogTitle>
            <DialogDescription>
              页面草稿已保留。之前失败的保存或上传不会自动重发，请登录后确认并手动重试。
            </DialogDescription>
          </DialogHeader>
          <LoginForm />
        </DialogContent>
      </Dialog>
    </>
  );
}
