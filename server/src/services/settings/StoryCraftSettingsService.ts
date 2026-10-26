import {
  DEFAULT_STORY_CRAFT_DEFAULTS,
  STORY_CRAFT_DEFAULTS_SETTING_KEY,
  normalizeStoryCraftDefaults,
  storyCraftDefaultsSchema,
  type StoryCraftDefaults,
} from "@ai-novel/shared/types/storyCraft";
import { prisma } from "../../db/prisma";

function isMissingTableError(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === "object"
    && "code" in error
    && (error as { code?: string }).code === "P2021",
  );
}

function isDbUnavailableError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const code = "code" in error ? (error as { code?: string }).code : undefined;
  const message = "message" in error ? String((error as { message?: unknown }).message ?? "") : "";
  return code === "P1001" || /can't reach database server/i.test(message);
}

function parseStoredSettings(value: string | null | undefined): StoryCraftDefaults {
  if (!value?.trim()) {
    return DEFAULT_STORY_CRAFT_DEFAULTS;
  }
  try {
    return normalizeStoryCraftDefaults(JSON.parse(value));
  } catch {
    return DEFAULT_STORY_CRAFT_DEFAULTS;
  }
}

/**
 * 读取全局通用创作规则。缺省、表不存在或数据损坏时都返回默认值：
 * 这条设置只增强规划与写作，不能因为读不到而阻断创作。
 */
export async function getStoryCraftDefaults(): Promise<StoryCraftDefaults> {
  try {
    const row = await prisma.appSetting.findUnique({
      where: { key: STORY_CRAFT_DEFAULTS_SETTING_KEY },
      select: { value: true },
    });
    return parseStoredSettings(row?.value);
  } catch (error) {
    if (isMissingTableError(error) || isDbUnavailableError(error)) {
      return DEFAULT_STORY_CRAFT_DEFAULTS;
    }
    throw error;
  }
}

/** 保存全局通用创作规则。写入前用共享 schema 归一，未知字段与越界值不会落库。 */
export async function saveStoryCraftDefaults(input: unknown): Promise<StoryCraftDefaults> {
  const normalized = storyCraftDefaultsSchema.parse(input);
  try {
    await prisma.appSetting.upsert({
      where: { key: STORY_CRAFT_DEFAULTS_SETTING_KEY },
      update: { value: JSON.stringify(normalized) },
      create: { key: STORY_CRAFT_DEFAULTS_SETTING_KEY, value: JSON.stringify(normalized) },
    });
  } catch (error) {
    if (isMissingTableError(error) || isDbUnavailableError(error)) {
      return normalized;
    }
    throw error;
  }
  return normalized;
}

/** 恢复默认：写回内建默认值，而不是删除记录。 */
export async function resetStoryCraftDefaults(): Promise<StoryCraftDefaults> {
  return saveStoryCraftDefaults(DEFAULT_STORY_CRAFT_DEFAULTS);
}
