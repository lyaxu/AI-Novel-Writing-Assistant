/**
 * Settings search index.
 *
 * "I know the setting exists, I can't find which page it's on" is not solved by a better sidebar:
 * people do not think in the product's page taxonomy, they think in the words of the thing they want
 * ("通知", "字数", "放行"). This list is keyed by those words and points at the concrete block.
 *
 * Keep it in step with the real sections: every entry must name a block that exists, and the label
 * should be the phrase a writer would use, not the internal title.
 */
export interface SettingsSearchEntry {
  /** What a writer would call it. */
  label: string;
  /** Words people actually type, including near-synonyms. */
  keywords: string[];
  /** Where it lands, so the search result is readable on its own. */
  where: string;
  to: string;
}

export const SETTINGS_SEARCH_ENTRIES: SettingsSearchEntry[] = [
  {
    label: "填写 API Key / 添加模型厂商",
    keywords: ["apikey", "api key", "密钥", "厂商", "厂家", "接入", "连接", "平台", "token"],
    where: "模型与厂商",
    to: "/settings/models",
  },
  {
    label: "选择写正文用的模型",
    keywords: ["模型", "正文模型", "用哪个模型", "写作模型", "换模型", "deepseek", "推理"],
    where: "模型与厂商",
    to: "/settings/models",
  },
  {
    label: "为不同任务分别指定模型",
    keywords: ["路由", "任务", "拆章", "审核", "分配", "不同任务", "模型路由"],
    where: "模型路由管理",
    to: "/settings/model-routes",
  },
  {
    label: "结构化输出出错时自动重试",
    keywords: ["容错", "重试", "json", "格式错误", "报错", "结构化"],
    where: "模型路由管理里的「结构化调用容错」",
    to: "/settings/model-routes",
  },
  {
    label: "出错时怎么处理（暂停还是继续写）",
    keywords: ["问题处理", "出错", "失败", "暂停", "继续", "策略", "规则", "中断"],
    where: "自动导演",
    to: "/settings/director",
  },
  {
    label: "哪些操作需要我确认、哪些自动放行",
    keywords: ["审批", "授权", "确认", "自动放行", "免确认", "待确认", "放行", "偏好"],
    where: "自动导演里的「审批授权偏好」与待确认自动放行",
    to: "/settings/director",
  },
  {
    label: "自动导演停下时提醒我",
    keywords: ["提醒", "通知", "浏览器提醒", "消息", "暂停提醒", "推送"],
    where: "自动导演里的暂停提醒",
    to: "/settings/director",
  },
  {
    label: "导演跟进用哪个通道",
    keywords: ["通道", "跟进", "渠道", "消息通道", "配置"],
    where: "自动导演里的「导演跟进通道配置」",
    to: "/settings/director",
  },
  {
    label: "开启资料检索 / 知识库向量",
    keywords: ["知识库", "向量", "检索", "召回", "embedding", "资料", "rag"],
    where: "知识库与写法",
    to: "/settings/knowledge",
  },
  {
    label: "写法偏好 / 文风 / 写法引擎",
    keywords: ["写法", "文风", "风格", "偏好", "引擎", "语气", "笔法"],
    where: "知识库与写法",
    to: "/settings/knowledge",
  },
  {
    label: "深色模式 / 界面外观 / 字号",
    keywords: ["外观", "主题", "深色", "暗色", "浅色", "字号", "界面", "显示"],
    where: "外观与主题",
    to: "/settings/appearance",
  },
  {
    label: "桌面版更新 / 旧数据 / 数据维护",
    keywords: ["更新", "升级", "维护", "旧数据", "迁移", "备份", "清理", "桌面"],
    where: "桌面与维护",
    to: "/settings/maintenance",
  },
];

/** Words a query is matched against: the label plus every keyword. */
export function matchesSettingsEntry(entry: SettingsSearchEntry, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return false;
  return `${entry.label} ${entry.keywords.join(" ")} ${entry.where}`.toLowerCase().includes(needle);
}
