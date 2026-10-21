export const settingsCatalog = [
  {
    title: "采集与运行",
    description: "先把直播或录播可靠地保存下来。",
    items: [
      {
        to: "/settings/automation",
        label: "房间自动化与启动",
        description: "设置各房间的自动录制、分析、渲染规则与服务端口。",
      },
      {
        to: "/settings/configuration?group=recording",
        label: "直播录制与弹幕",
        description: "画质、分段、开播守候、断流重连和弹幕采集。",
      },
      {
        to: "/settings/configuration?group=storage",
        label: "存储与清理",
        description: "磁盘空间、原始录像保留与清理策略。",
      },
    ],
  },
  {
    title: "分析与成片",
    description: "从语音、弹幕和高光线索到最终切片。",
    items: [
      {
        to: "/settings/configuration?group=asr",
        label: "语音转写",
        description: "本地或远程 ASR、模型、设备和识别质量。",
      },
      {
        to: "/settings/configuration?group=highlights",
        label: "高光识别",
        description: "热点检测、评分、候选阈值和时间范围。",
      },
      {
        to: "/settings/configuration?group=review",
        label: "审核规则",
        description: "审核策略、领取租约及人工确认。",
      },
      {
        to: "/settings/configuration?group=output",
        label: "成片与编码",
        description: "视频编码、字幕弹幕、画面比例与声音处理。",
      },
      {
        to: "/settings/subtitles",
        label: "字幕模板",
        description: "字幕字体、颜色和排版样式。",
      },
      {
        to: "/settings/intros",
        label: "片头与片尾",
        description: "管理成片开头和结尾的文字、样式与时长。",
      },
    ],
  },
  {
    title: "账号与外部服务",
    description: "连接直播平台、模型服务与发布渠道。",
    items: [
      {
        to: "/settings/login",
        label: "Bilibili 账号",
        description: "扫码登录、更新 Cookie，检查平台账号状态。",
      },
      {
        to: "/settings/llm",
        label: "大模型服务",
        description: "配置服务商、模型、API 密钥和失败回退。",
      },
      {
        to: "/settings/configuration?group=llm",
        label: "模型预算与转写润色",
        description: "控制模型调用预算、输出及转写润色策略。",
      },
      {
        to: "/settings/configuration?group=publishing",
        label: "上传与发布",
        description: "投稿工具、自动上传开关和发布阈值。",
      },
      {
        to: "/settings/configuration?group=trends",
        label: "网感采集",
        description: "资料来源、定时采集和保留策略。",
      },
    ],
  },
  {
    title: "提醒与维护",
    description: "及时发现问题，管理扩展与系统参数。",
    items: [
      {
        to: "/settings/notifications",
        label: "提醒与通知",
        description: "配置 SMTP、验证目标邮箱和选择运行提醒内容。",
      },
      {
        to: "/settings/plugins",
        label: "插件中心",
        description: "发现、启停插件并配置扩展能力。",
      },
      {
        to: "/settings/configuration?group=system",
        label: "账号与系统",
        description: "管理访问、日志及部署相关的参数说明。",
      },
      {
        to: "/settings/configuration",
        label: "全部参数",
        description: "跨分类搜索，查看完整配置及高级选项。",
      },
    ],
  },
] as const;

export function settingsTopic(key: string, group: string) {
  if (group === "recording") {
    if (/danmaku|collect_danmaku/.test(key)) return "弹幕采集与连接";
    if (/live_|schedule_|room_metadata_/.test(key)) return "开播守候与预约";
    if (/reconnect|auto_recover/.test(key)) return "断流恢复与保护";
    return "录像、画质与分段";
  }
  if (group === "asr") {
    if (/remote/.test(key)) return "远程转写服务";
    if (/device|concurrency|keep_loaded|idle|timeout|preload/.test(key))
      return "设备、并发与资源";
    if (/model|path/.test(key)) return "模型与文件";
    return "识别引擎与质量";
  }
  if (group === "notifications") {
    if (/smtp_/.test(key)) return "邮件服务";
    if (/lark_/.test(key)) return "飞书应用机器人";
    if (/webhook|dingtalk|wecom/.test(key)) return "机器人与 Webhook";
    return "提醒规则";
  }
  if (group === "output") {
    if (/subtitle|danmaku/.test(key)) return "字幕与弹幕";
    if (/audio|loudnorm|silence/.test(key)) return "声音处理";
    return "画面、编码与成片";
  }
  return "参数设置";
}
