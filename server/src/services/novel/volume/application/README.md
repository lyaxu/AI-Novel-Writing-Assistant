# 有界缺章规划

`boundedChapterList` 服务于 ChapterRouteWindowService 的滚动补章。全书章号由既有卷节奏预算累计定位，不由已生成的 Chapter 或 VolumeChapterPlan 数量决定；因此中间断号、稀疏计划及跨卷第 N 章使用同一契约。

调用必须携带内部 `chapterOrderRange`，当前路线服务每次只补一个缺号。章节列表的 registered prompt 接收精确槽位、前后已规划/已写事实；输出只能追加缺号，不能重写整段、重排已有章节或把阶段中间章误作节奏段终章。生成后仍通过正常任务单/语义/窗口门禁，不能用规划列表代替写前批准。

`VolumeChapterSyncService.materializationRange` 限定 Chapter 表的本次物化范围，完整规划工作区仍保留；有界同步禁止删除。已经存在计划的缺号优先同步，不重新请求章节列表。新能力通过 NovelVolumeService 的既有 facade 使用，外部不得直接调用内部生成实现。
