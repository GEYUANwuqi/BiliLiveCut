import { useSyncExternalStore } from "react";
import { api, upload, type Row } from "@/api/client";
import { obj, rows } from "@/lib/data";

export interface ImportItem {
  declaration: Row;
  record?: Row;
  video?: File;
  comments?: File;
  submitted?: boolean;
}

export interface ImportProgress {
  busy: boolean;
  step: string;
  percent: number;
  error: string;
  recordId: string;
  position: number;
  total: number;
}
let state: ImportProgress = {
  busy: false,
  step: "",
  percent: 0,
  error: "",
  recordId: "",
  position: 0,
  total: 0,
};
let controller: AbortController | null = null;
const listeners = new Set<() => void>();
function update(value: Partial<ImportProgress>) {
  state = { ...state, ...value };
  listeners.forEach((listener) => listener());
}
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
export const useImportProgress = () =>
  useSyncExternalStore(subscribe, () => state);
export const cancelImportUpload = () => controller?.abort();

/** Upload a batch serially, retaining each acknowledged file and submitted job. */
export async function runImportBatch(
  items: ImportItem[],
  onItem: (index: number, item: ImportItem) => void,
): Promise<void> {
  if (state.busy) throw new Error("已有上传正在进行");
  controller = new AbortController();
  const signal = controller.signal;
  update({
    busy: true,
    step: "正在登记导入",
    percent: 0,
    error: "",
    recordId: "",
    position: 0,
    total: items.length,
  });
  try {
    for (const [index, item] of items.entries()) {
      if (item.submitted) continue;
      if (signal.aborted) throw new DOMException("上传已停止", "AbortError");
      update({
        position: index + 1,
        percent: 0,
        step: "正在登记导入",
        recordId: String(item.record?.id || ""),
      });
      await submitImport(item, signal, (next) => onItem(index, next));
    }
    update({ step: "已提交后台预处理", error: "" });
  } catch (error) {
    const message =
      error instanceof DOMException && error.name === "AbortError"
        ? "上传已停止，已上传文件保留，可继续剩余队列。"
        : error instanceof Error
          ? error.message
          : "导入失败";
    update({ error: message });
    throw error;
  } finally {
    controller = null;
    update({ busy: false });
  }
}

async function submitImport(
  item: ImportItem,
  signal: AbortSignal,
  onItem: (item: ImportItem) => void,
): Promise<void> {
  const { declaration, video, comments } = item;
  let current = item.record;
  if (current?.id) {
    const id = current.id;
    const listing = obj(await api("/api/recording-imports", { signal }));
    current = rows(listing.imports).find((record) => record.id === id);
    if (!current) throw new Error("导入记录已不存在，请新建导入");
  } else
    current = obj(
      await api("/api/recording-imports", {
        method: "POST",
        body: JSON.stringify(declaration),
        signal,
      }),
    );
  update({ recordId: String(current.id) });
  onItem({ ...item, record: current });
  for (const [kind, file] of [
    ["video", video],
    ["comments", comments],
  ] as const) {
    if (signal.aborted) throw new DOMException("上传已停止", "AbortError");
    if (
      current[`${kind}_uploaded`] ||
      (kind === "comments" && !current.comments_name)
    )
      continue;
    if (!file) throw new Error(`请重新选择 ${current[`${kind}_name`]}`);
    if (file.name !== current[`${kind}_name`])
      throw new Error(`文件名不匹配，请选择 ${current[`${kind}_name`]}`);
    update({
      step: kind === "video" ? "正在上传视频" : "正在上传弹幕",
      percent: 0,
    });
    const result = obj(
      await upload(
        `/api/recording-imports/${encodeURIComponent(String(current.id))}/files/${kind}`,
        file,
        (percent) => update({ percent }),
        signal,
      ),
    );
    current = { ...current, ...result, [`${kind}_uploaded`]: true };
    onItem({ ...item, record: current });
  }
  if (signal.aborted) throw new DOMException("上传已停止", "AbortError");
  update({ step: "正在提交预处理", percent: 100 });
  await api(
    `/api/recording-imports/${encodeURIComponent(String(current.id))}/start`,
    { method: "POST" },
  );
  onItem({ ...item, record: current, submitted: true });
}
