# server 测试里 `dist` 加载失败类失败的诊断路径

## 背景

`server/tests/` 下有一批测试直接从 `server/dist/**` 加载编译产物（而不是用
`source()` + vm mock 加载源码）。这类测试失败时错误信息容易误导，常见两类：

```
TypeError: XxxService_1.XxxService is not a constructor
Cannot read properties of undefined (reading 'map')
```

它们看起来像"源码坏了"，**多数情况下不是**。下面是从 331 个测试文件的全量运行里
得到的诊断顺序。

## 当前规则（按顺序查，不要跳步）

1. **先确认类是否还存在。** 全量搜 `src` 与 `dist`：
   搜不到 = 测试指向了已被删除或改名的类，属**测试陈旧**，不是产品缺陷。
   实例：`RagJobListingService`、`NovelPlanningService` 在 src 与 dist 里都不存在。
2. **两边都在时，看导出形态。** 检查 `dist` 文件里的 `exports.X = X` 是否存在。
   实例：`RagContextualChunkService` 在 `dist/services/rag/RagContextualChunkService.js:141`
   确实有 `exports.RagContextualChunkService = ...`。
3. **导出正常却仍报 `_1.X is not a constructor` 时，查模块加载顺序。**
   错误里的 `_1` 是 TypeScript 编译后的命名空间别名（`import * as X_1`），
   说明报错位置在**调用方**的编译产物里，而不是类自身。此时优先怀疑循环引用
   或初始化顺序，而不是类没导出。
4. **确认 `dist` 是否新鲜。** 比较 `dist/**.js` 与 `src/**.ts` 的修改时间。
   若 dist 比源码旧，先重新构建再判断，否则是在诊断一个不存在的状态。

## 失败模式

- **把加载失败当成产品缺陷去改源码。** 先按上面四步定位，多数是测试陈旧或构建过期。
- **只跑测试子集。** 用文件名前缀过滤（如只跑 `chapter|volume|prompting`）会漏掉
  不在前缀里的文件。本项目就因此漏过两个真实问题：一个缺数据库迁移、
  一个测试缺 mock 导致整个文件加载失败。**会话收尾至少跑一次全量。**
- **用 `node --test <目录>` 跑整个目录。** 该方式在本仓库只得到 1 个失败项
  （聚合加载失败），信息量为零；应逐文件运行以得到逐文件的通过/失败计数。

## 与真实缺陷的区分

以下情况**确实是产品问题**，不能按"测试陈旧"放过：

- 缺数据库迁移（`prismaMigrationCompleteness`）：schema 有列但迁移没有，
  新装用户跑 `migrate deploy` 会建出不完整的库。这类问题在本地已有数据的机器上
  永远看不到。
- 预言失败但类与导出都正常、且调用链在生产代码里（不是测试）——按第 3 步继续查。

## 相关模块

- `server/tests/`（逐文件运行以获取准确计数）
- `server/dist/`（旧产物会制造假失败）
- `server/src/prisma/migrations{,.sqlite}/`（迁移完整性）
