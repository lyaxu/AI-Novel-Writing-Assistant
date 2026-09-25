import { z } from "zod";
import { prisma } from "../../../db/prisma";
import { llmProviderSchema } from "../../../llm/providerSchema";
import { AppError } from "../../../middleware/errorHandler";
import { runTextPrompt } from "../../../prompting/core/promptRunner";
import { secondReaderPrompt } from "../../../prompting/prompts/novel/secondReader.prompts";

const settingsSchema = z.object({
  provider: llmProviderSchema,
  model: z.string().trim().min(1),
  temperature: z.number().min(0).max(2).default(0.3),
});

export class SecondReaderService {
  async read(novelId: string, startOrder: number, endOrder: number) {
    if (!Number.isInteger(startOrder) || !Number.isInteger(endOrder) || startOrder < 1 || endOrder < startOrder) {
      throw new AppError("请选择有效的章节范围。", 400);
    }
    const setting = await prisma.appSetting.findUnique({ where: { key: "llm.secondReader" } });
    let rawSettings: unknown = null;
    try { rawSettings = setting ? JSON.parse(setting.value) : null; } catch { /* Invalid saved configuration is handled below. */ }
    const options = settingsSchema.safeParse(rawSettings);
    if (!options.success) throw new AppError("请先配置第二读者模型。", 400);
    const novel = await prisma.novel.findUnique({ where: { id: novelId }, select: { title: true, description: true } });
    if (!novel) throw new AppError("小说不存在。", 404);
    const chapters = await prisma.chapter.findMany({
      where: { novelId, order: { gte: startOrder, lte: endOrder } },
      orderBy: { order: "asc" }, select: { order: true, title: true, content: true },
    });
    if (chapters.length !== endOrder - startOrder + 1 || chapters.some(c => !c.content?.trim())) {
      throw new AppError("所选范围有缺失或未完成正文的章节，请缩小范围。", 400);
    }
    const text = chapters.map(c => `第${c.order}章 ${c.title}\n${c.content}`).join("\n\n");
    if (text.length + (novel.description?.length ?? 0) > 80000) {
      throw new AppError("本次内容超过8万字符，请分段复核；不会截断正文后给出整卷结论。", 400);
    }
    // Deliberately bypass audit/quality-loop services: this report owns no workflow state.
    const result = await runTextPrompt({
      asset: secondReaderPrompt,
      promptInput: { title: novel.title, description: novel.description ?? "", chapters: text },
      options: { ...options.data, maxTokens: 3500 },
    });
    if (!result.output.trim()) throw new AppError("第二读者未返回意见，请稍后重试。", 502);
    return { text: result.output.trim(), model: options.data.model, startOrder, endOrder, reviewedAt: new Date().toISOString() };
  }
}
