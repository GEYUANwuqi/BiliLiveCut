import { useRef } from "react";
import { Link } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  FileText,
  Film,
  FolderUp,
  Play,
  Plus,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useAction, useApi, type Row, type Schemas } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent } from "@/components/ui/card";
import {
  ConfirmButton,
  Empty,
  Page,
  QueryState,
  Refresh,
  Status,
} from "@/components/workbench";
import { useDraft } from "@/lib/drafts";
import { duration, number, obj, rows, text, time } from "@/lib/data";
import {
  cancelImportUpload,
  runImportBatch,
  useImportProgress,
  type ImportItem,
} from "@/features/import-controller";
import { fileStem, planImports, type ImportPair } from "@/features/import-plan";

function requestId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
}

export default function ImportsPage() {
  const query = useApi("/api/recording-imports");
  const cache = useQueryClient();
  const action = useAction();
  const draft = useDraft<Row>("recording-import", {});
  const progress = useImportProgress();
  const videoRef = useRef<HTMLInputElement>(null);
  const commentsRef = useRef<HTMLInputElement>(null);
  const data = obj(query.data);
  const imports = rows(data.imports);
  const record = obj(draft.value.record);
  const videos = (draft.value.videos || []) as File[];
  const comments = (draft.value.comments || []) as File[];
  const batch = draft.value.batch as ImportItem[] | undefined;
  const videoLimit = number(data.max_video_bytes) || 50 * 1024 ** 3;
  const commentLimit = number(data.max_comment_bytes) || 32 * 1024 ** 2;
  let plan: ImportPair[] = [];
  let pairingError = "";
  if (videos.length && !record.id && !batch) {
    try {
      plan = planImports(videos, comments, videoLimit, commentLimit);
    } catch (error) {
      pairingError = error instanceof Error ? error.message : "文件配对失败";
    }
  }
  function update(value: Row): void {
    draft.update({ ...draft.value, ...value });
  }
  function select(files: File[], kind: "videos" | "comments"): void {
    if (!files.length) return;
    if (record.id && files.length !== 1) {
      toast.error("继续已有记录时请选择一份同名文件");
      return;
    }
    if (record.id) {
      const expected =
        record[kind === "videos" ? "video_name" : "comments_name"];
      if (!expected || files[0].name !== expected) {
        toast.error(
          expected
            ? `请重新选择 ${expected}`
            : "本条记录未声明弹幕，请新建导入",
        );
        return;
      }
    }
    const limit = kind === "videos" ? videoLimit : commentLimit;
    const allowed =
      kind === "videos"
        ? /\.(mp4|mkv|flv|ts|mov|webm|m4v)$/i
        : /\.(xml|json|srt|ass)$/i;
    if (
      files.some(
        (file) =>
          !allowed.test(file.name) || file.size === 0 || file.size > limit,
      )
    ) {
      toast.error(
        `文件格式不支持、文件为空或超过限制（${(limit / 1024 ** (kind === "videos" ? 3 : 2)).toFixed(0)} ${kind === "videos" ? "GiB" : "MiB"}）`,
      );
      return;
    }
    update({
      [kind]: files,
    });
  }
  async function submit(): Promise<void> {
    if (progress.busy) return;
    if (!batch && !record.video_uploaded && !videos.length) {
      toast.error("请选择视频文件");
      return;
    }
    if (
      !batch &&
      record.comments_name &&
      !record.comments_uploaded &&
      !comments.length
    ) {
      toast.error(`请重新选择 ${record.comments_name}`);
      return;
    }
    const offset = Number(draft.value.offset_s || 0);
    if (!Number.isFinite(offset) || Math.abs(offset) > 604800) {
      toast.error("弹幕偏移应在正负 604800 秒以内");
      return;
    }
    try {
      let queue: ImportItem[];
      if (batch) queue = [...batch];
      else if (record.id)
        queue = [
          { declaration: {}, record, video: videos[0], comments: comments[0] },
        ];
      else {
        const pairs = planImports(videos, comments, videoLimit, commentLimit);
        const title = String(draft.value.title || "").trim();
        queue = pairs.map((pair): ImportItem => {
          const stem = fileStem(pair.video.name);
          const declaration: Schemas["ImportRequest"] = {
            title: (title
              ? pairs.length > 1
                ? `${title} · ${stem}`
                : title
              : stem
            ).slice(0, 200),
            video_name: pair.video.name,
            comments_name: pair.comments?.name || null,
            offset_s: offset,
            request_id: requestId(),
          };
          return { ...pair, declaration };
        });
      }
      const snapshot = { ...draft.value, batch: queue };
      draft.update(snapshot);
      await runImportBatch(queue, (index, next) => {
        queue = queue.map((item, position) =>
          position === index ? next : item,
        );
        draft.update({ ...snapshot, batch: queue });
      });
      draft.reset();
      toast.success("录播已提交，预处理和分析在后台继续");
      await cache.invalidateQueries({ queryKey: ["api"] });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError"))
        toast.error(error instanceof Error ? error.message : "导入失败");
      await query.refetch();
    }
  }
  function resume(item: Row): void {
    if (
      batch &&
      !window.confirm(
        "切换导入会放弃本页剩余队列；已创建记录仍保留。是否继续？",
      )
    )
      return;
    draft.update({
      record: item,
      title: item.title,
      offset_s: item.offset_s,
      request_id: item.request_id,
    });
    toast.info("已恢复导入声明，请选择尚未上传的文件");
  }
  return (
    <Page
      eyebrow="CAPTURE / RECORDING IMPORT"
      title="录播分析"
      description="把已有的视频和弹幕带进工作台，继续转写、寻找高光与制作切片。"
      actions={
        <>
          <Refresh refresh={query.refetch} busy={query.isFetching} />
          <Button
            variant="outline"
            disabled={progress.busy}
            onClick={() => {
              if (
                batch &&
                !window.confirm(
                  "放弃本页剩余队列并重新选择？已创建记录仍保留。",
                )
              )
                return;
              draft.reset();
              if (videoRef.current) videoRef.current.value = "";
              if (commentsRef.current) commentsRef.current.value = "";
            }}
          >
            <Plus className="size-4" />
            新建导入
          </Button>
        </>
      }
    >
      <div className="grid items-start gap-6 xl:grid-cols-[1.3fr_1fr]">
        <Card className="gap-0 py-0 shadow-none">
          <CardContent className="p-6">
            <div className="mb-5 flex items-center gap-3">
              <span className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
                <FolderUp className="size-5" />
              </span>
              <div>
                <h2 className="font-semibold">
                  {record.id || batch ? "继续未完成的导入" : "导入录播"}
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  可多选视频，弹幕按文件名配对
                </p>
              </div>
            </div>
            <fieldset disabled={progress.busy || !!batch} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="import-title">录播标题</Label>
                <Input
                  id="import-title"
                  maxLength={200}
                  value={String(draft.value.title || "")}
                  disabled={!!record.id}
                  placeholder="可留空使用文件名；多段时作为标题前缀"
                  onChange={(event) => update({ title: event.target.value })}
                />
              </div>
              <div
                className="import-dropzone"
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  if (!progress.busy && !batch && !record.video_uploaded)
                    select(Array.from(event.dataTransfer.files), "videos");
                }}
              >
                <Film className="mb-3 size-8 text-primary/70" />
                {record.video_uploaded ? (
                  <p className="flex items-center gap-2 text-sm text-emerald-600">
                    <CheckCircle2 className="size-4" />
                    视频已经上传
                  </p>
                ) : (
                  <>
                    <p className="max-w-full truncate text-sm font-medium">
                      {videos.length
                        ? videos.map((file) => file.name).join("、")
                        : "拖入视频，或点击选择文件"}
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      MP4、MKV、FLV、TS、MOV、WebM · 最大{" "}
                      {(videoLimit / 1024 ** 3).toFixed(0)} GiB
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mt-4"
                      onClick={() => videoRef.current?.click()}
                    >
                      选择视频
                    </Button>
                  </>
                )}
                <input
                  ref={videoRef}
                  hidden
                  type="file"
                  multiple={!record.id}
                  accept=".mp4,.mkv,.flv,.ts,.mov,.webm,.m4v"
                  aria-label="选择录播视频"
                  onChange={(event) =>
                    select(Array.from(event.target.files || []), "videos")
                  }
                />
              </div>
              <div className="rounded-xl border p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-sm">
                    <FileText className="size-4 text-muted-foreground" />
                    弹幕文件{" "}
                    <span className="text-xs text-muted-foreground">可选</span>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    type="button"
                    disabled={!!record.comments_uploaded}
                    onClick={() => commentsRef.current?.click()}
                  >
                    {record.comments_uploaded ? "已上传" : "选择弹幕"}
                  </Button>
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {comments.map((file) => file.name).join("、") ||
                    text(
                      record.comments_name,
                      "XML、JSON、SRT、ASS；支持后续继续上传",
                    )}
                </p>
                <input
                  ref={commentsRef}
                  hidden
                  type="file"
                  multiple={!record.id}
                  accept=".xml,.json,.srt,.ass"
                  aria-label="选择弹幕文件"
                  onChange={(event) =>
                    select(Array.from(event.target.files || []), "comments")
                  }
                />
                <div className="mt-4 flex items-center gap-3">
                  <Label htmlFor="import-offset" className="shrink-0 text-xs">
                    弹幕偏移（秒）
                  </Label>
                  <Input
                    id="import-offset"
                    type="number"
                    step="any"
                    min={-604800}
                    max={604800}
                    value={String(draft.value.offset_s ?? 0)}
                    disabled={!!record.id}
                    onChange={(event) =>
                      update({ offset_s: event.target.value })
                    }
                  />
                </div>
              </div>
            </fieldset>
            {pairingError && (
              <p className="error-panel mt-4 text-sm" role="alert">
                {pairingError}
              </p>
            )}
            {(batch || plan.length > 0) && (
              <div
                className="mt-4 space-y-2 text-sm"
                aria-label="文件配对与上传队列"
              >
                <p>
                  共 {batch?.length || plan.length} 段 · 已提交{" "}
                  {batch?.filter((item) => item.submitted).length || 0} 段
                </p>
                <ol>
                  {(batch || plan).map((item, index) => (
                    <li key={index}>
                      {item.video?.name ||
                        text((item as ImportItem).record?.video_name)}{" "}
                      →{" "}
                      {item.comments?.name ||
                        text(
                          (item as ImportItem).record?.comments_name,
                          "无弹幕",
                        )}
                      {batch?.[index].submitted ? " · 已提交" : " · 待完成"}
                    </li>
                  ))}
                </ol>
              </div>
            )}
            {progress.busy && (
              <div className="mt-5 space-y-3" role="status">
                <div className="flex justify-between text-xs">
                  <span>
                    第 {progress.position}/{progress.total} 段 · {progress.step}
                  </span>
                  <span>{progress.percent}%</span>
                </div>
                <Progress value={progress.percent} />
              </div>
            )}
            {progress.error && (
              <p className="error-panel mt-4 text-sm" role="alert">
                {progress.error}
              </p>
            )}
            <div className="mt-6 flex items-center justify-between gap-3 border-t pt-5">
              <p className="text-xs text-muted-foreground">
                文件直接上传至你的服务，不提供本地路径给后端。
              </p>
              {progress.busy ? (
                <Button
                  variant="outline"
                  disabled={progress.step === "正在提交预处理"}
                  onClick={cancelImportUpload}
                >
                  <X className="size-4" />
                  停止上传
                </Button>
              ) : (
                <Button disabled={!!pairingError} onClick={() => void submit()}>
                  <Upload className="size-4" />
                  {record.id || batch ? "继续上传并分析" : "上传并开始分析"}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
        <div className="space-y-4">
          <div className="rounded-2xl border bg-card p-6">
            <p className="eyebrow">A CLEARER WORKFLOW</p>
            <h2 className="mt-3 text-lg font-semibold">让内容走向高光</h2>
            <div className="mt-6 space-y-6">
              {[
                ["01", "上传与预处理", "检查视频，将媒体按关键帧分段。"],
                [
                  "02",
                  "语音转写与高光分析",
                  "使用已配置的引擎和模型寻找候选。",
                ],
                [
                  "03",
                  "人工审核与成片",
                  "确认时间边界、字幕和内容，再渲染切片。",
                ],
              ].map(([step, label, description]) => (
                <div key={step} className="flex gap-4">
                  <span className="text-sm font-medium text-primary/60">
                    {step}
                  </span>
                  <div>
                    <h3 className="text-sm font-medium">{label}</h3>
                    <p className="mt-1 text-xs leading-6 text-muted-foreground">
                      {description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <p className="px-2 text-xs leading-6 text-muted-foreground">
            上传中可切换工作台页面。刷新或关闭浏览器会中断尚未上传的部分；已上传文件与后台作业可从下面的记录恢复。真实转写需要先准备对应模型。
          </p>
        </div>
      </div>
      <section>
        <div className="section-heading">
          <div>
            <h2>导入记录</h2>
            <p>恢复上传，或查看预处理与分析进度</p>
          </div>
          <span className="text-xs text-muted-foreground">
            {imports.length} 条记录
          </span>
        </div>
        <QueryState query={query}>
          {imports.length ? (
            <div className="space-y-4">
              {imports.map((item) => {
                const job = obj(item.job);
                const analysis = obj(item.analysis);
                const status =
                  job.status || (!item.sealed ? "draft" : "queued");
                return (
                  <Card key={text(item.id)} className="gap-0 py-0 shadow-none">
                    <CardContent className="flex flex-wrap items-center gap-4 p-5">
                      <span className="grid size-11 place-items-center rounded-xl bg-muted">
                        <Film className="size-5 text-muted-foreground" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-sm font-semibold">
                            {text(item.title)}
                          </h3>
                          <Status value={status} />
                        </div>
                        <p className="mt-2 text-xs text-muted-foreground">
                          {time(item.created_at)} · {duration(item.duration_s)}{" "}
                          · 视频{item.video_uploaded ? "已上传" : "待上传"}
                          {item.comments_name
                            ? ` · 弹幕${item.comments_uploaded ? "已上传" : "待上传"}`
                            : ""}
                        </p>
                        {item.analysis ? (
                          <p className="mt-2 text-xs text-muted-foreground">
                            分析 {number(analysis.done)} /{" "}
                            {number(analysis.total)} 段 · 转写{" "}
                            {number(analysis.transcripts)} 段 · 失败{" "}
                            {number(analysis.failed)}
                          </p>
                        ) : null}
                        {job.message || job.error ? (
                          <p className="mt-2 text-xs text-amber-700">
                            {text(job.error || job.message)}
                          </p>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {!item.sealed && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={progress.busy}
                            onClick={() => resume(item)}
                          >
                            继续上传
                          </Button>
                        )}
                        {item.session_id ? (
                          <Button size="sm" asChild>
                            <Link to={`/sessions?session=${item.session_id}`}>
                              查看分析
                              <Play className="size-3" />
                            </Link>
                          </Button>
                        ) : null}
                        {Boolean(item.sealed) &&
                          ["failed", "cancelled"].includes(
                            String(job.status),
                          ) && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={action.isPending}
                              onClick={() =>
                                action.mutate({
                                  path: `/api/recording-imports/${item.id}/start`,
                                  success: "已重新提交预处理",
                                })
                              }
                            >
                              重新处理
                            </Button>
                          )}
                        {["queued", "running"].includes(String(job.status)) && (
                          <ConfirmButton
                            title="取消预处理？"
                            description="停止当前后台作业，上传记录保留，可在之后重试。"
                            onConfirm={() =>
                              action.mutateAsync({
                                path: `/api/jobs/${job.id}/cancel`,
                                success: "取消请求已提交",
                              })
                            }
                          >
                            取消处理
                          </ConfirmButton>
                        )}
                        <ConfirmButton
                          destructive
                          disabled={progress.busy}
                          title="删除导入记录？"
                          description="删除暂存记录与相关上传文件；服务端会检查当前作业状态。"
                          onConfirm={() =>
                            action.mutateAsync({
                              path: `/api/recording-imports/${item.id}`,
                              method: "DELETE",
                              success: "导入记录已删除",
                            })
                          }
                        >
                          删除
                        </ConfirmButton>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          ) : (
            <Empty
              title="还没有导入记录"
              description="选择一个视频并开始分析，导入进度和恢复入口会显示在这里。"
            />
          )}
        </QueryState>
      </section>
    </Page>
  );
}
