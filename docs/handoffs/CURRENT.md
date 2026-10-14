# 最新交接入口

当前为阶段3规划授权到原生产恢复的整链修复，接续96098132；最新完整快照为[规划授权接续原生产恢复](../evals/2026-10-14-planning-original-pipeline-recovery.md)。此前[写前合同修复](../evals/2026-10-13-planning-required-elements.md)中的“按自定义方向修复”已由用户执行，不能再按旧指引追加授权。

## 当前事实与恢复链

书《外卖小哥的茅山账本》cmv3wyvw40015gow0780pycx9；原导演cmv3wvaqm000sgow0l5or2pke。用户保存的授权86b7d1f1-7317-4326-8fa1-ce855243c93d仍为已用2/总3轮，第三轮未开始。错误新job cmv7n3mug000240w0aj5dvutf与原job cmv7le2h30004qow0s4f66mfr的paused journal冲突；此外旧规划门禁被误记为未知外部调用，两环均须收敛。

修复后显式源页命令核验授权、规划来源、候选、原稿指纹、范围和执行权，在事务内接回原job；完整证据才能把已结束的规划暂停转为可重入状态，原记录归档保留。真正未知调用、来源变化、取消或有效租约仍拒绝。同一授权不追加次数，质量检查及防丢稿不变。读取、轮询及服务启动不能自行恢复。

## 验证与加载

server编译通过；封网组合1156项中1154通过、0失败、2项既有拆书skip，含本次真实现场整链14项。覆盖原命令重派、Continue、原job恢复、原journal、实际规划准备与Store提交；模型回答仅离线替身。并发/重复授权不加轮，来源变化、取消、租约、真正未知调用及三处CAS冲突均保护现场。客户端未变，UI与真实模型验收留给用户。 受控加载待核验。当前仍处工程验证阶段，未调用真实模型、未写真实任务数据。不能把离线结果当作阶段3真实稳定或固定版本十章通过。

## 用户继续入口

完成加载核验后，打开[原书节奏 / 拆章](http://127.0.0.1:5190/novels/cmv3wyvw40015gow0780pycx9/edit?directorTaskId=cmv3wvaqm000sgow0l5or2pke&stage=structured)，刷新，在规划修复面板点击一次“继续已授权修复”。使用本次2/3的现有授权，不重新填写方向或点击追加修复，不新建导演，不重跑第二章审查。

## 主线与边界

主线仍为旧版核心生产链：可靠保存、失败从原步恢复、阶段3完整生产链收敛，随后固定版本十章验收。原任务范围1—3，不能称作十章已获准或通过。第一章3013字、第二章3680字，第三章空；累计调用51、代理0。新版不动，不恢复历史书，不另建GUI，保留写法、质量检查和防丢稿。

仓库D:/novel/AI-Novel-Writing-Assistant，分支codex/production-core-refactor；隔离DB D:/novel/.comparison/2026-10-10/old-test.db。预存三个Structured客户端改动及台账历史964行保持独立，不push/合并/发布。旧前端5190/PID41368、新版5173/8787关闭的隔离配置保留。

长期边界[PROJECT_CONTEXT](PROJECT_CONTEXT.md)，统一[台账](WORK_LEDGER.md)，[批准方案](../plans/2026-10-11-production-core-refactor.md)，[十章验收单](../evals/2026-10-11-ten-chapter-acceptance.md)，[恢复wiki](../wiki/workflows/chapter-review-resume.md)。[断线续作与书内agent](../plans/2026-10-11-resilient-writing-and-book-agent-ideas.md)仍为待设计事项。
