export interface ImportPair {
  video: File;
  comments?: File;
}

export const fileStem = (name: string): string => name.replace(/\.[^.]+$/, "");
const key = (name: string): string => name.normalize("NFC").toLowerCase();

/** Validate every file and reject ambiguous pairing before any upload begins. */
export function planImports(
  videos: File[],
  comments: File[],
  videoLimit: number,
  commentLimit: number,
): ImportPair[] {
  if (!videos.length) throw new Error("请选择视频文件");
  const validate = (file: File, limit: number, extension: RegExp): void => {
    if (
      !file.name ||
      file.name.length > 255 ||
      /[/\\]/.test(file.name) ||
      Array.from(file.name).some((character) => character.charCodeAt(0) < 32)
    )
      throw new Error(`文件名不支持：${file.name}`);
    if (!extension.test(file.name) || !fileStem(file.name).trim())
      throw new Error(`文件格式或主文件名不支持：${file.name}`);
    if (!Number.isSafeInteger(file.size) || file.size <= 0 || file.size > limit)
      throw new Error(`文件为空或超过大小限制：${file.name}`);
  };
  const byStem = new Map<string, ImportPair>();
  const byName = new Map<string, ImportPair>();
  const pairs = videos.map((video): ImportPair => {
    validate(video, videoLimit, /\.(mp4|mkv|flv|ts|mov|webm|m4v)$/i);
    const stem = key(fileStem(video.name));
    if (byStem.has(stem)) throw new Error(`视频主文件名重复：${video.name}`);
    const pair = { video };
    byStem.set(stem, pair);
    byName.set(key(video.name), pair);
    return pair;
  });
  const seen = new Set<string>();
  for (const file of comments) {
    validate(file, commentLimit, /\.(xml|json|srt|ass)$/i);
    const stem = key(fileStem(file.name));
    if (seen.has(stem)) throw new Error(`同名弹幕有多个文件：${file.name}`);
    seen.add(stem);
    const matches =
      videos.length === 1 && comments.length === 1
        ? [pairs[0]]
        : [
            ...new Set(
              [byStem.get(stem), byName.get(stem)].filter(
                (pair): pair is ImportPair => !!pair,
              ),
            ),
          ];
    if (!matches.length) throw new Error(`弹幕没有对应视频：${file.name}`);
    if (matches.length !== 1 || matches[0].comments)
      throw new Error(`弹幕配对不唯一：${file.name}`);
    matches[0].comments = file;
  }
  const order = new Intl.Collator("zh-CN", {
    numeric: true,
    sensitivity: "base",
  });
  return pairs.sort((a, b) => order.compare(a.video.name, b.video.name));
}
