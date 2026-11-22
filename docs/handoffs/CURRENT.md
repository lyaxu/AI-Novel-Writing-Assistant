# 最新交接入口

**当前首选摘要：** [2026-11-23 阶段交接](2026-11-23_bounded-session-handoff.md)。先读该文件、`AGENTS.md` 和 `PROJECT_CONTEXT.md`，不要默认全读历史。

## 当前事实（2026-11-23 核验）

- 仓库：`D:/novel/AI-Novel-Writing-Assistant`
- 分支：`codex/production-core-refactor`（远端 `lyaxu`）
- 运行库：`D:/novel/.comparison/2026-10-10/old-test.db`
- 服务：本地测试端口 3000 / 5190；改动前用 `/api/health` 核验 `gitHead/stale`
- 用户当前偏好：题材匹配优先；按“三章一验收”推进；不以朱雀分数为唯一质量目标
- 本轮阶段书：《杂役管事在黑市商城》第 1–10 章全部 completed，任务 `cmwpv9y2b002tuww0smo5q10h` succeeded；第 10 章为保留正文的降级验收，证据与质量债可见
- 第 11、12 章未写
- 旧长附录已归档：[CURRENT-2026-11-21.md](archive/CURRENT-2026-11-21.md)
- 更早完整移交包：`2026-10-18_1130_deepseek-harness-handoff.md` 及其子目录

## 下一步

1. 用用户喜欢的新题材开一本新书，按 3 章范围验证是否能顺畅收口。
2. 先看 [2026-11-23 阶段交接](2026-11-23_bounded-session-handoff.md) 的“已验证 vs 未验证”和“下一阶段建议”，不要复述历史故障流水。
3. 新停点按 wiki 的通用恢复分类诊断；不写本书专用分支，不重写已有正文。

## 保护边界

- 三个 `Structured*` 组件和 `WORK_LEDGER.md` 的本地未提交内容不覆盖。
- 不切分支、不 stash/clean/reset、不做无备份的破坏性数据库操作。
- 服务重载只在不影响运行中的生成任务时进行；重载前先核验 health 和任务状态。
