# 阶段3：规划修复的必达事项与完整合同一致性

## 本次真实停点

用户时区2026-10-13 23:13（UTC 2026-10-14 04:13），原导演已从误完成状态进入第3章规划，原1—3授权范围保留。第三章实体已建立但正文0字；前两章3013/3680字SHA256与上次交付完全相同。原任务等待 `step_review_required`，修复会话 `waiting_confirmation`，预算2/2，原第三章job `cmv7le2h30004qow0s4f66mfr` 失败并保存候选。

原导演 `cmv3wvaqm000sgow0l5or2pke`、书 `cmv3wyvw40015gow0780pycx9`、第三章 `cmv7le2dq0002qow0mxfnhkt8`；卷规划章ID `cmv3wyvw40015gow0780pycx9-chapter-9f667b39-ed35-4ab2-a00c-f4c9c5ff27e9`。原统计窗口调用42→51，本次9次均由用户继续触发，正常stop；代理调用0，活跃任务/命令/副作用0。不是断网或正文保存失败。

## 根因与证据

主因分类：实现缺陷，且正常产品路径可重复产生。第三章初始规划再次安排第二章已完成的付款与拍照。第1轮修复已将scene_4改为确认已收报酬、查看已有照片并补拍新状态，章级复核通过，但独立窗口复核发现 requiredElements 仍要求重新付款/拍原照片而拒绝；第2轮再次修改场景，最后章级复核仍检出同一合同冲突。

`planningRepairChangeSchema`不提供必达事项修订字段，`applyPlanningRepairCandidate`强制继承原scenePlan.requiredElements。这原是防止修复时丢失必达事项的保护，但也把已被正文证实错误的事项锁死。修复AI收到明确反馈却没有合法输出通道，耗完两轮仍无法修复。门禁此次拦截有依据，应修正修复契约，不能关闭门禁或只修改提示。

## 本轮修复边界

通过AI结构化、同章显式修订，把原句、替换句、修订理由、保留的叙事职责及对应场景送入修复输出。确定性代码只校验来源、适用范围、映射唯一性与保存一致性，不猜测两句话是否语义等价；章级及窗口AI继续核对完整合同和已写正文。未修订事项原样保留，不提供自由删光清单的捷径。

场景计划为必达事项的保存来源；如候选携带兼容顶层副本，必须与之同步。已应用映射与候选同次保存，未成功应用的模型输出仅属历史，不能成为幂等凭证；旧响应不含新字段时保留原事项，不伪造修订。显式恢复保留原候选、两轮历史及预算，普通继续和重启不能追加模型调用或重置轮次。

## 验证与加载

私有现场及保护核验在 `.codex-run/planning-contract-revision-20261013`；原回答来自 `.codex-run/director-scope-completion-20261013/20261013-125419-old-server.llm.jsonl`。本轮 server TypeScript 编译通过；组合封网回归1139项，1137通过、0失败、2项既有拆书测试skip。新增现场与恢复13项全过，包含在组合计数中。覆盖真实两轮回答原样回放、历史审查样本、完整合同同步、其他义务/正文/远期第203章保护、多轮映射/幂等/分叉/循环拒绝、原暂停入口、追加一轮幂等及来源重取证。

首次扩展运行发现旧测试缺少新恢复依赖替身，以及旧HTTP测试与严格封网冲突；仅补齐替身、保持CommonJS模块身份，并将真实Express路由改为内存请求后完整重跑通过，没有放开外网或真实数据库。日志 `offline-final.log`、`tsc-final.log` 可复核。客户端本轮未变，复用前序范围修复的12项状态测试，不重复UI验证；UI由用户验收。

最终只读复核补充历史sceneKeys与当前场景落实的提示词边界：场景合法重排不能仅因旧key消失而被拒绝，仍检查最终职责是否落实。之后重新server编译及49项相关回归通过（final-prompt-check.log）；其余生产逻辑未变，复用组合1137项通过结果。

04:46 UTC只读核验候选、原任务、两章正文、空第三章、6项资源、51调用及2/2预算均与基线相同，活跃0，代理模型调用0。代码提交后仅按原隔离配置加载旧后端；具体运行身份补记于末节。真实原答回放和新契约的人工模拟分别保存；不能宣称真实规划复核或十章文学验收通过。

## 原任务操作

本次停在写前规划，不是第二章正文审查。修复加载后打开[原书节奏 / 拆章](http://127.0.0.1:5190/novels/cmv3wyvw40015gow0780pycx9/edit?directorTaskId=cmv3wvaqm000sgow0l5or2pke&stage=structured&volumeId=cmv3wyvw40015gow0780pycx9-volume-aba7a8e2-4a3b-49d3-bc43-b33d4cca4a7e)，刷新；在规划修复面板展开“高级：自定义修复方向（可选）”，填入下述方向，点击一次“按自定义方向修复”。该动作明确增加1轮修复并复核，保留原候选和两轮历史；复核通过后沿原导演范围接续。

建议方向：以已写正文为准，修正所有重复已完成事件的必达事项，保留原叙事职责和回报；同步核对必达事项、场景、禁止事项与回收引用，不改已写正文，不扩大章节范围。

只复核旧候选不能改正旧必达事项，普通“继续自动导演”也不能绕过2/2预算。代理不代替用户授权或点击。代码级验证不保证真实模型下一答一定通过；有依据的冲突仍应保留门禁。

## 已加载并核验

2026-10-14 04:52 UTC（用户时区10-13 23:52）完成旧版受控加载：代码25c77110a7bc，旧后端3000/PID39024，应用启动04:51:57.366Z；经5190代理health核对source模式、stale=false、75项源码/共享产物SHA256通过。旧前端41368/5190身份不变，新版5173/8787保持关闭。

真实只读规划恢复GET确认原任务waiting_confirmation、pendingManualRecovery=true、2/2且recoveryRequest为空；书级GET也已读取留证。两接口前后只读SQLite核验原seed/候选、已写两章、空第三章、资源、原job及51调用不变，活跃0、代理模型调用0。没有发出恢复命令，不重置次数。无需用户运行启动脚本，从上文原书规划面板明确追加修复即可。

证据在本轮私有目录：source-manifest.json、health-loaded.json、planning-repair-loaded.json、book-automation-loaded.json、baseline.json、verified-state.json、loaded-process.json及新服务日志。此次收尾只同步运行事实，复用1137项组合通过（2既有skip）、最终49项相关检查及编译，不重复构建或重载；其后文档提交不改变已加载代码。

## 10-14用户授权后秒停：执行衔接未通过

用户截图2026-10-14 00:00:16显示2/3轮和“继续已授权修复”，上方报执行约定/所有权变化。UTC04:58:46.131的POST返回202，原请求86b7d1f1-7317-4326-8fa1-ce855243c93d已授权且仍保留，rounds2/maxRounds3。命令成功派发，新job cmv7n3mug000240w0aj5dvutf在04:58:46.504创建、.589失败；修复AI尚未运行，调用51不变。

05:02只读SQLite与代码确认：第三章active production journal仍为pipeline:cmv7le2h30004qow0s4f66mfr:cmv7le2dq0002qow0mxfnhkt8，status=paused。新job以新operation进入runPipelineChapter，replaceCompletedOnly=true，session.open拒绝覆盖未完成journal。旧prepare.execution_contract记录unknown，错误实为“已完成2轮修正，规划仍未通过复核”；恢复设计还须区分这个已确认规划结论与真正不确定的外部调用，不能简单清journal、解锁或置为completed。

原导演queued/pendingManualRecovery=1，checkpoint chapter_batch_ready承载冲突说明；repair仍reviewing/2/3且recoveryAction保留。前两章3013/3680字及hash不变，第三章空。此次不是用户少点一步，也不是新修复提示词再次失败；已通过的原离线组未覆盖“真实旧job规划暂停journal→明确授权→新job接续”组合，应补该链并校验重复点击和未知调用保护。暂不建议用户点“继续已授权修复”，不追加新一轮。

证据：同一私有目录granted-stop-state.json、inspect-granted-stop.cjs、原服务log及用户本地截图。本轮仅诊断与文档同步，未写真实DB、调用模型、重启或修改产品代码；不把本次记录当修复完成。主线仍为阶段3规划、审查、可靠保存与恢复一致性，十章未通过。
