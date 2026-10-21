import { useEffect, useMemo, useRef, useState } from "react";
import {
  ScrollRestoration,
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
} from "react-router";
import {
  Activity,
  Bell,
  ChartNoAxesCombined,
  ChevronDown,
  CircleHelp,
  Clapperboard,
  Command,
  FolderKanban,
  Gauge,
  LayoutDashboard,
  ListTodo,
  LogOut,
  Menu,
  Moon,
  Radio,
  Search,
  Settings2,
  ShieldCheck,
  Sun,
  TerminalSquare,
  TextSearch,
  Upload,
  Video,
  WandSparkles,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { logout, useAuth, changePassword } from "@/api/auth";
import { getPauseUntil, useApi } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FormDialog } from "@/components/workbench";
import { TourTarget, useOnboarding } from "@/components/onboarding";
import { hasDrafts } from "@/lib/drafts";
import { rows, text, time } from "@/lib/data";
import { cn } from "@/lib/utils";

export const navigation = [
  {
    label: "工作空间",
    items: [
      { to: "/", label: "工作台概览", icon: LayoutDashboard },
      { to: "/rooms", label: "直播间", icon: Radio },
      { to: "/recording", label: "录制状态", icon: Video },
      { to: "/imports", label: "录播分析", icon: Upload },
      { to: "/transcripts", label: "语音转写", icon: TextSearch },
      { to: "/danmaku", label: "弹幕热度", icon: Activity },
    ],
  },
  {
    label: "高光制作",
    items: [
      { to: "/sessions", label: "场次时间线", icon: WandSparkles },
      { to: "/review", label: "人工审片", icon: ShieldCheck },
      { to: "/topics", label: "主题与合集", icon: FolderKanban },
      { to: "/clips", label: "成品切片", icon: Clapperboard },
      { to: "/uploads", label: "上传与发布", icon: Upload },
      { to: "/trends", label: "网感资料库", icon: Gauge },
    ],
  },
  {
    label: "管理",
    items: [
      { to: "/tasks", label: "任务队列", icon: ListTodo },
      { to: "/analytics", label: "数据分析", icon: ChartNoAxesCombined },
      { to: "/monitor", label: "运行状态", icon: Activity },
      { to: "/logs", label: "错误日志", icon: TerminalSquare },
      { to: "/settings", label: "设置中心", icon: Settings2 },
    ],
  },
];

export function Shell() {
  const auth = useAuth();
  const intro = useOnboarding();
  const touring = intro.stage.startsWith("tour:");
  const location = useLocation();
  const navigate = useNavigate();
  const query = useQueryClient();
  const [mobile, setMobile] = useState(false);
  const [command, setCommand] = useState(false);
  const [search, setSearch] = useState("");
  const [notices, setNotices] = useState(false);
  const [seen, setSeen] = useState(0);
  const [dark, setDark] = useState(
    () => localStorage.getItem("blc-theme") === "dark",
  );
  const [pause, setPause] = useState(getPauseUntil);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    setMobile(touring);
  }, [touring]);
  const noticeQuery = useApi(
    "/api/notifications?since_id=0",
    10000,
    auth.role === "admin",
  );
  const notifications = useMemo(
    () => rows(noticeQuery.data),
    [noticeQuery.data],
  );
  const lastNotice = useRef<number | null>(null);
  const groups =
    auth.role === "reviewer"
      ? [{ label: "审核工作台", items: [navigation[1].items[1]] }]
      : navigation;
  const links = groups.flatMap((group) => group.items);
  const current = [...links]
    .sort((a, b) => b.to.length - a.to.length)
    .find((item) =>
      item.to === "/"
        ? location.pathname === "/"
        : location.pathname.startsWith(item.to),
    );
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("blc-theme", dark ? "dark" : "light");
  }, [dark]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommand((value) => !value);
      }
    };
    const leave = (event: BeforeUnloadEvent) => {
      if (hasDrafts()) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const identity = (event: Event) => {
      if ((event as CustomEvent<{ clear: boolean }>).detail.clear) {
        setSeen(0);
        lastNotice.current = null;
      } else void query.invalidateQueries();
    };
    const rate = (event: Event) =>
      setPause((event as CustomEvent<number>).detail);
    document.addEventListener("keydown", key);
    window.addEventListener("beforeunload", leave);
    window.addEventListener("blc:identity", identity);
    window.addEventListener("blc:rate-limit", rate);
    return () => {
      document.removeEventListener("keydown", key);
      window.removeEventListener("beforeunload", leave);
      window.removeEventListener("blc:identity", identity);
      window.removeEventListener("blc:rate-limit", rate);
    };
  }, [query]);
  useEffect(() => {
    if (!pause) return;
    const timer = setInterval(() => {
      const value = Date.now();
      setNow(value);
      if (value >= pause) {
        setPause(0);
        void query.invalidateQueries();
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [pause, query]);
  useEffect(() => {
    if (!notifications.length) return;
    const latest = Math.max(...notifications.map((entry) => Number(entry.id)));
    if (lastNotice.current !== null)
      notifications
        .filter((entry) => Number(entry.id) > lastNotice.current!)
        .forEach((entry) => {
          const show =
            entry.kind === "error"
              ? toast.error
              : entry.kind === "success"
                ? toast.success
                : toast.info;
          show(text(entry.message));
        });
    lastNotice.current = latest;
  }, [notifications]);
  return (
    <div className="min-h-dvh bg-background">
      <ScrollRestoration />
      {mobile && (
        <button
          aria-label="关闭导航遮罩"
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm lg:hidden"
          onClick={() => setMobile(false)}
        />
      )}
      <aside className={cn("sidebar", mobile && "sidebar-open")}>
        <NavLink
          to="/"
          className="sidebar-brand"
          onClick={() => setMobile(false)}
        >
          <span className="brand-symbol">
            <Clapperboard className="size-5" />
          </span>
          <span>
            BiliLiveCut<small>HIGHLIGHT WORKSPACE</small>
          </span>
        </NavLink>
        <div className="px-4 pb-5">
          <button className="sidebar-search" onClick={() => setCommand(true)}>
            <Search className="size-3.5" />
            <span>快速前往</span>
            <kbd>⌘ K</kbd>
          </button>
        </div>
        <nav className="sidebar-scroll">
          {groups.map((group) => (
            <div key={group.label} className="mb-6">
              <p className="sidebar-label">{group.label}</p>
              {group.items.map(({ to, label, icon: Icon }) => (
                <TourTarget path={to} key={to}>
                  <NavLink
                    key={to}
                    to={to}
                    end={to === "/"}
                    onClick={() => {
                      if (!touring) setMobile(false);
                    }}
                    className={({ isActive }) =>
                      cn("sidebar-link", isActive && "sidebar-link-active")
                    }
                  >
                    <Icon className="size-[17px]" />
                    <span>{label}</span>
                  </NavLink>
                </TourTarget>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <span
            className={cn(
              "size-1.5 rounded-full",
              auth.authenticated ? "bg-emerald-400" : "bg-amber-400",
            )}
          />
          <span>{auth.authenticated ? "工作台已连接" : "等待重新登录"}</span>
          <span className="ml-auto text-[10px]">ALPHA</span>
        </div>
      </aside>
      <div className="lg:pl-[232px]">
        <header className="workspace-header">
          <Button
            size="icon"
            variant="ghost"
            className="lg:hidden"
            onClick={() => setMobile(true)}
            aria-label="展开导航"
          >
            <Menu />
          </Button>
          <div className="flex min-w-0 flex-1 items-center gap-2 text-sm">
            <span className="hidden text-muted-foreground sm:inline">
              工作空间
            </span>
            <span className="hidden text-border sm:inline">/</span>
            <span className="truncate font-medium">
              {current?.label || "编辑工作台"}
            </span>
          </div>
          <Badge
            variant="outline"
            className="hidden text-[10px] tracking-wider md:inline-flex"
          >
            {auth.role === "reviewer" ? "REVIEW" : "WORKSPACE"}
          </Badge>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setDark(!dark)}
            aria-label={dark ? "切换浅色模式" : "切换深色模式"}
          >
            {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </Button>
          {auth.role === "admin" && (
            <Button
              variant="ghost"
              size="icon"
              aria-label="重新打开使用引导"
              onClick={intro.open}
            >
              <CircleHelp className="size-4" />
            </Button>
          )}
          {auth.role === "admin" && (
            <Button
              variant="ghost"
              size="icon"
              className="relative"
              aria-label="通知中心"
              onClick={() => {
                setNotices(true);
                setSeen(lastNotice.current || 0);
              }}
            >
              <Bell className="size-4" />
              {notifications.some((entry) => Number(entry.id) > seen) && (
                <span className="absolute top-1.5 right-2 size-1.5 rounded-full bg-primary" />
              )}
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="gap-2 pl-1">
                <span className="grid size-7 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                  {auth.username.slice(0, 1).toUpperCase()}
                </span>
                <span className="hidden max-w-28 truncate text-xs sm:inline">
                  {auth.username}
                </span>
                <ChevronDown className="size-3 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem disabled>
                {auth.mode === "local"
                  ? "本机免登录访问"
                  : auth.role === "admin"
                    ? "后台管理员"
                    : "审核员"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {auth.mode !== "local" && (
                <DropdownMenuItem
                  onClick={() =>
                    void logout().catch((error: Error) =>
                      toast.error(error.message),
                    )
                  }
                >
                  <LogOut className="size-4" />
                  退出登录
                </DropdownMenuItem>
              )}
              {auth.mode === "session" && (
                <DropdownMenuItem
                  onClick={() =>
                    void logout(true).catch((error: Error) =>
                      toast.error(error.message),
                    )
                  }
                >
                  退出所有设备
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </header>
        {pause > now && (
          <div
            role="alert"
            className="border-b border-amber-200 bg-amber-50 px-6 py-3 text-sm text-amber-900"
          >
            请求过于频繁，已暂停请求。将在 {Math.ceil((pause - now) / 1000)}{" "}
            秒后恢复读取；保存操作请手动重试。
          </div>
        )}
        <main className="mx-auto max-w-[1600px] px-5 py-7 sm:px-8 xl:px-10 xl:py-9">
          <Outlet />
        </main>
        <footer className="mx-auto flex max-w-[1600px] items-center justify-between px-8 pt-2 pb-6 text-[11px] text-muted-foreground">
          <span>BiliLiveCut · 从录播到粗剪切片</span>
          <span>为每一个值得保留的片刻</span>
        </footer>
      </div>
      <Dialog open={command} onOpenChange={setCommand}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Command className="size-4" />
              快速前往
            </DialogTitle>
            <DialogDescription>
              搜索工作台功能，按回车打开第一个结果。
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            placeholder="搜索页面或功能…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                const match = links.find((entry) =>
                  entry.label.includes(search),
                );
                if (match) {
                  navigate(match.to);
                  setCommand(false);
                }
              }
            }}
          />
          <div className="max-h-80 space-y-1 overflow-auto">
            {links
              .filter((entry) => entry.label.includes(search))
              .map(({ to, label, icon: Icon }) => (
                <button
                  key={to}
                  className="command-result"
                  onClick={() => {
                    navigate(to);
                    setCommand(false);
                    setSearch("");
                  }}
                >
                  <Icon className="size-4 text-muted-foreground" />
                  {label}
                  <ArrowKey />
                </button>
              ))}
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={notices} onOpenChange={setNotices}>
        <DialogContent className="max-h-[80dvh] overflow-auto">
          <DialogHeader>
            <DialogTitle>通知中心</DialogTitle>
            <DialogDescription>录制、任务与成品的最新状态。</DialogDescription>
          </DialogHeader>
          {notifications.length ? (
            [...notifications].reverse().map((entry) => (
              <div key={text(entry.id)} className="border-b py-3">
                <p className="text-sm leading-6">{text(entry.message)}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {time(
                    typeof entry.created_at === "number"
                      ? new Date(entry.created_at * 1000).toISOString()
                      : entry.created_at,
                  )}
                </p>
              </div>
            ))
          ) : (
            <p className="py-12 text-center text-sm text-muted-foreground">
              还没有通知
            </p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ArrowKey() {
  return <span className="ml-auto text-xs text-muted-foreground">↵</span>;
}

export function PasswordButton() {
  const auth = useAuth();
  if (auth.mode !== "session" || auth.role !== "admin") return null;
  if (auth.managed_by_environment)
    return <Badge variant="outline">密码由部署环境管理</Badge>;
  return (
    <FormDialog
      id="admin-password"
      title="修改后台密码"
      description="修改后所有旧会话会退出，需要使用新密码重新登录。"
      trigger={<Button variant="outline">修改后台密码</Button>}
      fields={[
        {
          name: "current_password",
          label: "当前密码",
          type: "password",
          required: true,
        },
        {
          name: "password",
          label: "新密码（12–128 字符）",
          type: "password",
          required: true,
        },
      ]}
      onSubmit={(value) =>
        changePassword(String(value.current_password), String(value.password))
      }
    />
  );
}
