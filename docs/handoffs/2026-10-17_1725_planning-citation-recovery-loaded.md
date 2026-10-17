# 规划审查引用与保留候选复核完成

## 接手摘要
2026-10-17 17:25（北京时间）。用户继续原任务后，写前审查两次引用不实而暂停。本轮已修复引用协议及明确复核入口，完成测试、个人远端推送和服务重载。原任务保持暂停，前五章不变；下一次真实执行由用户从本书源页点击“重新复核保留候选”。

## 环境与唯一真源
- 工作区 D:/novel/AI-Novel-Writing-Assistant；分支 codex/production-core-refactor，跟踪 lyaxu 同名分支。未合并 main/beta，无需新建仓库。
- 代码提交 68bcbb093fce701e0ab46bf556d0fa282442e43c 已推送并核对远端一致；交接、CURRENT、台账随后单独提交推送，以最终Git HEAD为准。
- Node24.19.0，后端3000/PID49200，前端5190/PID54884；17:24:13加载68bcbb093fce，health source/stale=false。
- DB固定 D:/novel/.comparison/2026-10-10/old-test.db；双击start-local.bat打开同一书稿环境，不用pnpm dev或原stop-local.bat。

## 用户目标与不可破坏约束
保留前五章、原任务暂停和原范围，先修工程链再由用户继续。用户允许必要模型验证；本轮采用离线回放，代理没有额外模型调用，也未提交恢复命令。质量门仍严格；引用修好不等于剧情通过。三个Structured组件和台账历史964行等旧工作保持未提交。

## 关键进程时间线
1. 用户约17:00恢复原任务：新增第六章空壳和执行合同候选，调用26→30，全库151→155。
2. 四次调用依次为章节清单、执行合同、质量审查、同候选纠正审查，合计213724 tokens。正文目录无缺字，索引0/1/2对应第3/4/5章。
3. 首次审查把第3章原句归到第5章；纠正后event_repetition引文来自历史规划requiredElements，knowledge_repetition来自压缩事实，均非正文。严格拒收正确，模型引文输出易混淆是主要因素。
4. 完整回答错误被包装后丢失回执，日志成为unknown。原候选虽保存，普通AI推荐建议不能绕过恢复证据门。
5. 实现正文证据编号及源页专用复核授权，保留未知原记录，不伪造确定完成回执。独立审查发现旧授权重放漂移、冲突归档和不完整租约边界，均补齐拒绝与测试。
6. 编译暴露可选属性类型错误，回归暴露旧记录缺省字段形状变化，均修复复验；最终366项通过。
7. 推送68bcbb09，核验旧PID后仅重载本环境两服务；真实GET入口available=true，保护摘要一致。随后同步文档与记忆。

## 已完成实现
- chapter_task_sheet_quality v18：progressionChecks.priorEvidence传输层只选正文目录evidenceId，由程序恢复准确sourcePath/quote，再走原严格校验。ID绑定实际正文、身份、路径、偏移；禁止旧ID、非正文、当前/未来章。持久化引文及正文验收v17保持兼容。
- 完整且经过验证的审查失败回执由质量服务继续传递；网络中断和输出截断不冒充完成。
- 源页“重新复核保留候选”：GET只读；勾选确认绑定当前token，固定review_existing，锁来源、候选、原job与journal；未知结果归档确认，预算和轮次不增。复核失败暂停，通过后按原范围继续。重复提交及入队失败沿用同次授权；拒绝漂移、其他未知调用、活跃租约和正文变化。
- 稳定规则见[叙事推进审查](../wiki/workflows/narrative-progression-review.md)、[规划修复](../wiki/workflows/planning-repair-loop.md)及模块README。发布说明与README已同步。

## 验证与实测结果
- Node24 server TypeScript编译、client typecheck通过。
- 18个针对性测试文件合计366/366通过，0跳过，包含新增恢复31项、只复核成功/逐章失败/窗口失败、引用协议、旧恢复链及生产日志。分组数不再相加。
- 实际失败回答离线回放：旧引文拒绝，换为对应正文ID后严格验证通过，现金冲突与repair_contract结论保留。这不是新模型回答或文学验收。
- 实际库只读来源/候选验证通过；重载后直连及5190代理health通过，新复核GET available=true/current6/range4—10；导演任务GET成功。
- 17:25保护复验：原导演完整记录、章节、job、候选、资源/人物等保护摘要与17:11基线一致；任务30调用/全库155；waiting_approval/pendingManualRecovery=1；technical_failed、rounds0/max2仍保留，第六章正文为空。
- 未做浏览器交互/视觉、新模型或十章文学验收；UI由用户验收。

五章完整SHA256：

| 章 | 字符数 | SHA256 |
| --- | --- | --- |
| 1 | 3013 | d4fb3b8f6b9230632a4bafe29740ae8744950ab105bc1e5e08562e7f883dcda6 |
| 2 | 3680 | 4704d2b0170166b28e798971db8c2b6aa295a04db03c9141bf16686330da309a |
| 3 | 3729 | 2260cac78879bfbd562ae19fd1363e0fd816a9b971c70236200a7981e66d172b |
| 4 | 3916 | e0b6d1a575df3ff1c668a6d7c92eb5be1fd991dffef387e4339846ba0464377b |
| 5 | 5808 | f1ab36068aa3c61026e0cc3ebd5850306e2569d9cb122270ad2ec9477f391fdc |

## 已知问题与临时绕过
无需绕过质量门。旧错误作为历史失败保留，重载不清记录或伪造新复核结果。原候选可能仍有真实质量问题；重新复核未通过就保持暂停并给后续处理。真实未知调用只有明确源页授权才能再发，不能靠普通继续或后台轮询清除。

## 未执行与待执行任务
- 优先：用户刷新原书源页，在规划修复区勾选确认后点“重新复核保留候选”；通过才继续6—10，未通过按新结果处理。无需先点普通继续或购买AI建议解决本次技术引用问题。
- 待用户验收：新复核/恢复真实链路、UI、连续性、人物身份、资源归属和用量。本次不是固定版本十章验收。
- 后续：另冻版本做正式十章；人物规划/候选改名独立样本，保留现书阵容；旧dashboard残留等沿前次交接等待反馈。

## 关键文件与产物索引
- 原书cmv3wyvw40015gow0780pycx9《外卖小哥的茅山账本》；原任务cmv8d55el0033z8w0hneoiiru；原job cmvc628nf0004mww0x0obr9fk。
- 第六章实体cmvc628hv0002mww0ei1eru9v；候选cmvc62qaf0007mww08k8tpvlv。
- 本地证据.codex-run/planning-citation-20261017/：manifest.local.json、fixture.sanitized.json、replay.cjs/replay-result.json、protected-baseline.json/protected-latest.json、server-build.log、client-typecheck.log、regression.log、reload.log、health.json、review-entry.json、task-after.json。日志及正文未提交。
- 原备份.codex-run/mainline-load-20261017/pre-migration-backup.db（1027043328字节）仍保留；本轮无迁移或业务数据修正，不把旧备份说成本轮30调用快照。
- 启动回执.logs/local-test/processes.json；源页 http://127.0.0.1:5190/novels/cmv3wyvw40015gow0780pycx9/edit?directorTaskId=cmv8d55el0033z8w0hneoiiru 。

## 下一窗口启动顺序
1. 读AGENTS→PROJECT_CONTEXT→CURRENT→本页，核验分支/HEAD/dirty。
2. 只读刷新任务、候选、正文、调用和进程；30调用与PID仅为本次时点。
3. 用户未点击则等待；用户已执行则根据新日志诊断，不重复发请求。
4. 续写结束先做恢复验收，再安排固定版本十章。

## 待确认事项与风险
代码完成、已推送、已加载、离线及接口验证通过；用户UI/模型/文学验收待做。正文ID只证明出处准确，语义关联仍由AI判断；不要把准确引文等同于判断正确。确认后的继续可能产生复核和写作费用，界面明确说明。当前可安全交接。

## 可直接发送给新窗口的开场提示
读取AGENTS和CURRENT。规划引用及保留候选复核入口已推送加载，366测试通过；前五章不变、第六章空稿、30调用、任务仍暂停。先只读核对是否已有用户新执行，再按最新结果接续，不自动恢复。
