export const setupSteps = [
  "初次见面",
  "B 站账号",
  "语音转写",
  "大模型分析",
  "准备出发",
];
export const tourSteps = [
  {
    path: "/rooms",
    title: "从一个直播间开始",
    body: "添加你有权录制的直播间，开始录制或开启开播守候。录制、自动分析与自动成片可按房间调整。",
  },
  {
    path: "/imports",
    title: "也可以直接导入录播",
    body: "选择已有的视频和可选的弹幕文件，先导入再分析，不必等待直播开播。",
  },
  {
    path: "/sessions",
    title: "沿时间线寻找高光",
    body: "按场次查看热点、证据与候选。ASR 负责听懂语音，LLM 帮助理解上下文，热点不等于最终成片。",
  },
  {
    path: "/review",
    title: "把最后的判断留给你",
    body: "人工预览、调整起止时间并审核候选，再生成粗剪。建议先检查效果，再决定是否启用自动批准和发布。",
  },
  {
    path: "/clips",
    title: "在这里找到成品",
    body: "查看、预览和下载已生成的切片。任务处理进度可在任务队列查看，录制结束并不意味着切片已经完成。",
  },
  {
    path: "/settings",
    title: "以后还可以继续调整",
    body: "账号、模型、录制、通知与高级参数都在设置中心。点击顶部的问号按钮，可以重新打开这份使用引导。",
  },
];
export type IntroStage = `setup:${number}` | `tour:${number}` | "done";
const memory = new Map<string, IntroStage>();
export const onboardingKey = (mode: string, username: string) =>
  `blc:onboarding:v1:${mode}:${encodeURIComponent(username)}`;
export function readIntro(key: string): IntroStage {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(key);
  } catch {
    /* 隐私模式仍允许在当前页面完成引导。 */
  }
  const value = memory.get(key) ?? stored;
  if (value === "done") return value;
  const match = /^(setup|tour):(\d+)$/.exec(value || "");
  if (
    match &&
    Number(match[2]) <
      (match[1] === "setup" ? setupSteps.length : tourSteps.length)
  )
    return value as IntroStage;
  return "setup:0";
}
export function writeIntro(key: string, stage: IntroStage) {
  memory.set(key, stage);
  try {
    localStorage.setItem(key, stage);
    memory.delete(key);
  } catch {
    /* 不把存储失败变成首次使用的阻塞。 */
  }
  window.dispatchEvent(new Event("blc:onboarding"));
}
export function subscribeIntro(listener: () => void) {
  window.addEventListener("storage", listener);
  window.addEventListener("blc:onboarding", listener);
  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener("blc:onboarding", listener);
  };
}
