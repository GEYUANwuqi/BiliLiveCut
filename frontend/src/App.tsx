import { lazy, Suspense, type ReactNode } from "react";
import {
  createBrowserRouter,
  Navigate,
  Outlet,
  RouterProvider,
  useRouteError,
} from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SessionBoundary } from "@/components/session";
import { Shell } from "@/components/shell";
import { useAuth } from "@/api/auth";
import { Empty } from "@/components/workbench";
import { Skeleton } from "@/components/ui/skeleton";
const Overview = lazy(() => import("./pages/overview")),
  Rooms = lazy(() => import("./pages/rooms")),
  Imports = lazy(() => import("./pages/imports")),
  Configuration = lazy(() => import("./pages/configuration"));
const library = (
  key:
    | "RecordingPage"
    | "SchedulesPage"
    | "TranscriptsPage"
    | "DanmakuPage"
    | "ClipsPage",
) => lazy(() => import("./pages/library").then((m) => ({ default: m[key] })));
const Recording = library("RecordingPage"),
  Schedules = library("SchedulesPage"),
  Transcripts = library("TranscriptsPage"),
  Danmaku = library("DanmakuPage"),
  Clips = library("ClipsPage");
const admin = (
  key:
    | "SettingsPage"
    | "AutomationPage"
    | "LlmPage"
    | "BilibiliLoginPage"
    | "PluginsPage"
    | "PluginSettingsPage",
) => lazy(() => import("./pages/admin").then((m) => ({ default: m[key] })));
const Settings = admin("SettingsPage"),
  Automation = admin("AutomationPage"),
  Llm = admin("LlmPage"),
  BiliLogin = admin("BilibiliLoginPage"),
  Plugins = admin("PluginsPage"),
  PluginSettings = admin("PluginSettingsPage"),
  Templates = lazy(() =>
    import("./pages/admin").then((m) => ({ default: m.TemplatesPage })),
  );
const ops = (
  key:
    | "TasksPage"
    | "UploadsPage"
    | "LogsPage"
    | "TrendsPage"
    | "AnalyticsPage"
    | "MonitorPage",
) =>
  lazy(() => import("./pages/operations").then((m) => ({ default: m[key] })));
const Tasks = ops("TasksPage"),
  Uploads = ops("UploadsPage"),
  Logs = ops("LogsPage"),
  Trends = ops("TrendsPage"),
  Analytics = ops("AnalyticsPage"),
  Monitor = ops("MonitorPage");
const Sessions = lazy(() =>
  import("./pages/sessions").then((m) => ({ default: m.SessionsPage })),
);
const ReviewQueue = lazy(() =>
  import("./pages/review").then((m) => ({ default: m.ReviewQueuePage })),
);
const Review = lazy(() =>
  import("./pages/review").then((m) => ({ default: m.ReviewPage })),
);
const Topics = lazy(() =>
  import("./pages/topics").then((m) => ({ default: m.TopicsPage })),
);
const Collection = lazy(() =>
  import("./pages/topics").then((m) => ({ default: m.CollectionPage })),
);
function AdminOnly() {
  return useAuth().role === "reviewer" ? (
    <Navigate to="/review" replace />
  ) : (
    <Outlet />
  );
}
function Load({ children }: { children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="space-y-5" role="status" aria-label="正在加载页面">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-64 w-full" />
        </div>
      }
    >
      {children}
    </Suspense>
  );
}
function RouteError() {
  const error = useRouteError();
  return (
    <div className="m-8">
      <Empty
        title="页面暂时无法显示"
        description={
          error instanceof Error ? error.message : "请重新加载页面后重试。"
        }
        action={
          <button className="native-select" onClick={() => location.reload()}>
            重新加载
          </button>
        }
      />
    </div>
  );
}
const pages: [string, ReactNode][] = [
  ["/rooms", <Rooms key="/rooms" />],
  ["/recording", <Recording key="/recording" />],
  ["/imports", <Imports key="/imports" />],
  ["/schedules", <Schedules key="/schedules" />],
  ["/transcripts", <Transcripts key="/transcripts" />],
  ["/danmaku", <Danmaku key="/danmaku" />],
  ["/sessions", <Sessions key="/sessions" />],
  ["/topics", <Topics key="/topics" />],
  ["/collection/:id", <Collection key="/collection/:id" />],
  ["/clips", <Clips key="/clips" />],
  ["/uploads", <Uploads key="/uploads" />],
  ["/trends", <Trends key="/trends" />],
  ["/tasks", <Tasks key="/tasks" />],
  ["/analytics", <Analytics key="/analytics" />],
  ["/monitor", <Monitor key="/monitor" />],
  ["/logs", <Logs key="/logs" />],
  ["/settings", <Settings key="/settings" />],
  ["/settings/configuration", <Configuration key="/settings/configuration" />],
  ["/settings/automation", <Automation key="/settings/automation" />],
  ["/settings/llm", <Llm key="/settings/llm" />],
  ["/settings/login", <BiliLogin key="/settings/login" />],
  ["/settings/plugins", <Plugins key="/settings/plugins" />],
  ["/plugins/:id/settings", <PluginSettings key="/plugins/:id/settings" />],
  ["/settings/subtitles", <Templates key="/settings/subtitles" />],
  ["/settings/intros", <Templates key="/settings/intros" intro />],
];
const router = createBrowserRouter([
  {
    element: (
      <SessionBoundary>
        <Shell />
      </SessionBoundary>
    ),
    errorElement: <RouteError />,
    children: [
      {
        element: <AdminOnly />,
        children: [
          {
            index: true,
            element: (
              <Load>
                <Overview />
              </Load>
            ),
          },
          ...pages.map(([path, element]) => ({
            path,
            element: <Load>{element}</Load>,
          })),
        ],
      },
      {
        path: "/review",
        element: (
          <Load>
            <ReviewQueue />
          </Load>
        ),
      },
      { path: "/review/queue", element: <Navigate to="/review" replace /> },
      {
        path: "/review/:id",
        element: (
          <Load>
            <Review />
          </Load>
        ),
      },
      {
        path: "*",
        element: (
          <Empty
            title="没有找到这个页面"
            description="使用侧栏导航或快捷搜索前往需要的功能。"
          />
        ),
      },
    ],
  },
]);
const query = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: false },
    mutations: { retry: false },
  },
});
export default function App() {
  return (
    <QueryClientProvider client={query}>
      <TooltipProvider>
        <RouterProvider router={router} />
        <Toaster richColors closeButton position="bottom-right" />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
