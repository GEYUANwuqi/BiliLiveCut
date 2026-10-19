# Web 页面开发与验证

业务控制台使用 React 19、TypeScript、Vite、Tailwind CSS 4 和 shadcn/ui。React Router 管理页面，TanStack Query 管理服务端读取与缓存，API 类型通过 openapi-typescript 从 FastAPI 的 OpenAPI 生成。文档站仍使用 VuePress，两个前端独立构建。

## 页面与后端边界

浏览器只访问前端地址。前端服务提供 `/`、工作台路由和静态资源，并把 `/api`、`/auth`、`/review/api`、`/collection/api`、`/openapi.json` 反向代理到 FastAPI。FastAPI 不再返回业务 HTML，也不再挂载旧 `/static`。

| 路径 | 职责 |
| --- | --- |
| `frontend/src/pages/` | 直播、导入、审片、合集、设置与运维页面 |
| `frontend/src/components/ui/` | shadcn/ui 基础组件 |
| `frontend/src/api/` | 认证、请求、OpenAPI 类型 |
| `frontend/src/lib/drafts.ts` | 当前浏览器内存中的编辑草稿 |
| `frontend/public/media-auth.js` | 为同源媒体请求附加当前标签页的 Basic 凭据 |
| `app/web/main.py`、`app/web/routers/` | 后端 API 与媒体 |
| `app/web/frontend_server.py` | 源码及 Portable 使用的独立静态服务进程 |
| `frontend/nginx.conf` | Docker 前端的静态服务与反向代理 |

旧模板和原生脚本保留在源码中供迁移核对，运行入口不再使用它们。

## 本地修改与刷新

准备 Python 3.12 和 Node.js 24。下面的命令都从当前工作树根目录执行；使用 Git worktree 时，每个工作树需要自己的 Python 环境。

首次运行先安装依赖（包含 Web、Whisper CPU 转写和 LLM 客户端，不下载转写模型）：

```bash
uv sync --locked --no-dev --extra web --extra asr-whisper --extra llm
```

如果终端激活了另一个工作树的虚拟环境，先执行 `deactivate`。不要使用 `--active` 指向旧环境。缺少 `Python.h` 或编译工具时，可以在安装命令前添加 `BLC_SKIP_C_EXTENSIONS=1`，使用 Python 实现运行；完整开发依赖及其他转写引擎见[开发环境](./environment.md)。

`--no-sync` 只适用于已经安装好依赖的环境，不会补装 `click` 等缺失依赖。直接跳过首次安装时，还可能从终端 PATH 找到其他工作树的旧 `blc` 脚本。下面使用当前环境的 Python 模块入口启动后端：

```bash
uv run --no-sync python -m app.cli backend --host 127.0.0.1 --port 8000 --reload
```

另开终端，进入同一个工作树根目录：

```bash
cd frontend
npm ci
npm run dev
```

打开 `http://127.0.0.1:5173`。Vite 对 React、CSS 修改提供热更新；`--reload` 只重启 Python。开发代理默认指向 `127.0.0.1:8000`，更换后端端口时设置 `BLC_API_PROXY`。Vite 会保留原始 Host，写操作的 Origin 与 CSRF 继续由后端验证。

后端重载只监听源码目录下的 `app/` 和 `config/`，修改打包脚本或测试文件不会触发重启。升级程序后，如果提示数据库应用版本不匹配，应先停止服务并备份原运行目录，再使用当前版本创建新数据库；Schema 编号相同也不能绕过应用版本校验。

默认从当前工作树读取 `.env`，数据写入该工作树的 `storage/`；不复制其他版本的数据库和 Cookie。单独设置运行目录时，需要同时设置存储和数据库路径，不能仅设置 `BLC_APP_ROOT`。编辑草稿与 Basic 密码只保存在当前页面内存，跨页面导航保留草稿；整页刷新或关闭后不会恢复。Docker 使用 HttpOnly 会话 Cookie，写操作携带 CSRF，过期后保留草稿并要求重新登录，不自动重放写操作。

## 构建与运行

安装后可执行文件名为 `blc`，由 Click 提供命令解析：

| 命令 | 运行内容 | 默认地址 |
| --- | --- | --- |
| `blc backend` | 仅 FastAPI 后端，可加 `--reload` | `127.0.0.1:8000`，或保存的启动端口 |
| `blc frontend` | 仅静态前端，代理到 `--backend` 指定的后端 | `127.0.0.1:8080` |
| `blc start` | 同时启动已构建前端和私有后端，统一管理退出 | `127.0.0.1:8000`，或保存的启动端口 |

`frontend`、`start` 要求 `frontend/dist/index.html` 存在，也可通过 `--frontend-dir` 或 `BLC_FRONTEND_DIR` 指定构建目录。它们不会自动调用 npm，不提供前端开发热更新。`serve`、`console` 分别作为 `backend`、`start` 的兼容别名。原有录制、转写、剪辑、上传、日程、配置和维护命令继续保留，使用 `blc --help` 或 `blc <命令> --help` 查看。

```bash
npm --prefix frontend run build
uv run --no-sync blc start --host 127.0.0.1 --port 8000
```

`start` 等待 API 启动后，启动另一个进程提供静态页面并代理 API；任一进程退出时会关闭另一个进程。运行构建产物不需要 Node.js。也可以分别运行两个服务：

```bash
uv run --no-sync blc backend --host 127.0.0.1 --port 8000
# 另一个终端，浏览器访问 8080
uv run --no-sync blc frontend --port 8080 --backend http://127.0.0.1:8000
```

对外服务推荐 Docker 中的 Nginx，或配置自己的 HTTPS 静态服务与反向代理。后端端口应保持内网访问；Basic 模式下，远程浏览器的媒体认证使用 Service Worker，需要 HTTPS 或 localhost 安全上下文。使用 SSH 隧道时访问本机 localhost 即可。

## 语法与交互检查

```bash
npm --prefix frontend ci
npm --prefix frontend run check
npm --prefix frontend exec playwright install chromium
npm --prefix frontend run test:e2e
```

检查包含 TypeScript、lint、Vitest 和构建；浏览器测试覆盖桌面与手机导航、空列表、设置计数、草稿保留、认证失效等行为。代理测试使用真实 HTTP 请求验证流式上传、Range、Cookie、CSRF、缓存和路由回退。

后端接口变化后，在已安装 web 依赖的 Python 环境执行：

```bash
uv run --no-sync python scripts/export_openapi.py
npm --prefix frontend run api:generate
```

旧模板与原生脚本的检查入口仍为 `python scripts/check_frontend.py`，覆盖工作台、配置、录播批量导入与波形交互。波形检查使用独立 `.mjs` 入口，不依赖标准输入结束，pytest 保留 30 秒超时与阶段诊断。CI 的 Python 测试矩阵使用 Node.js 22。

将 `frontend/openapi.json` 和生成的 `src/api/schema.d.ts` 一并更新。CI 使用 `--check` 检查规范是否同步，再重新生成类型验证差异。导出脚本使用临时配置目录，不启动应用生命周期，也不会读取正在运行实例的数据库。

## 功能与验收范围

页面入口覆盖直播间和房间自动化、录制控制和预约、录播导入及恢复、转写校正、弹幕证据与归档、整场时间线和总结、多人审核及边界调整、主题合集、成品和投稿、网感、流水线与后台作业、分析、模型与磁盘状态、日志，以及所有运行参数、服务商、插件、账号和模板。

验收仍需使用真实媒体、已准备的 ASR 模型和可用的服务配置，完成一次录制或导入到审核渲染的链路。模拟浏览器测试不会证明平台登录、取流、模型推理或投稿已经成功。
