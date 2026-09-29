# 两个小说 Skill 的方法研究与本项目取舍

研究日期：2026-09-28（纽约）。直接阅读公开仓库 README、SKILL 与相关参考文件；未安装、fork、执行脚本或运行小说生成。以下是静态设计评审，不是作品效果或性能验证。

## chinese-novelist-skill

来源：[仓库](https://github.com/PenglongHuang/chinese-novelist-skill)、[规划流程](https://github.com/PenglongHuang/chinese-novelist-skill/blob/master/references/flows/phase2-planning.md)、[验收流程](https://github.com/PenglongHuang/chinese-novelist-skill/blob/master/references/flows/phase4-validation.md)。

值得参考的是分层收集创作意图，以及为单本书建立文风基准：先有目标风格，再用成稿校准。适合未来改善本项目的写法体验，避免所有题材共用同一套去AI味规则。现有新手引导、候选确认和个人写法应继续复用，不另造平行入口。

不直接采用“每章必爽”、固定篇幅、固定对话比例、固定短句长度。它们可以是某本书的风格偏好，不能作为七类题材的共同质量条件。连续章节并行写作也不能只凭速度收益替代状态依赖。

README提及连贯性校验，但所读 phase4 文件的具体自动验收主要依据文件存在与字数，重试耗尽仍可完成并附警告。这能说明工作流边界，不能证明已实现可靠的语义连续性检查。不能将宣传能力直接当作可复用代码。

## Novel-Control-Station-Skill

来源：[仓库](https://github.com/jingtai123/Novel-Control-Station-Skill)、[主流程](https://github.com/jingtai123/Novel-Control-Station-Skill/blob/main/SKILL.md)。

与本阶段最相关的三个方法：

1. [时代与人物](https://github.com/jingtai123/Novel-Control-Station-Skill/blob/main/references/epoch-and-people-resonance.md)：将宏观变化落实到制度与个人生活的后果。应用到本项目，就是书级视角同时交代具体处境和主线联系；不是额外填一段宏大背景。
2. [遗忘与线索活跃度](https://github.com/jingtai123/Novel-Control-Station-Skill/blob/main/references/forgotten-elements-and-line-heat.md)：人物回归看实际作用，不能提到名字就算延续。未来适合改善人物、关系和伏笔的延迟回报；文档中的章数阈值只作参考，不转成强制插入角色的机械规则。
3. [图式回忆](https://github.com/jingtai123/Novel-Control-Station-Skill/blob/main/references/graph-and-recall-control.md)：按当前章召回相关关系和事件，派生索引服从原始事实。未来可改善长篇上下文；本项目以数据库及已接受正文为准，不另建一套Markdown真源，也不为小项目强制建图。

该项目强调主题由选择表达、先清楚终点、各条情节相互影响。这些是本期书级契约的设计参考。全量人物档案、全书细纲和大量资料文件不应机械转成新手填写步骤；本工具的渐进规划、源工作区操作和既有恢复预算继续有效。

## 本期采用与后续边界

本期独立实现：AI结构化书级大底、世界边界、人物自身动机与主线联系、具体视角；宏观阶段由AI按故事给出；候选可见、既有数据链保存与传递。未复制源代码或安装外部Skill。

后续候选：卷级多线因果交织、人物与关系的有意义回归、按需长篇事实召回、单书文风校准。它们目前不是已实现能力，也不因加入书级字段就自动完成。

第一验收层是字段不丢失、旧书兼容、阶段不被固定模板覆盖。第二层才是七题材真实生成对照及独立阅读，须同时记录误报、漏检、字数、成本与延时。两仓库的设计说明不能替代这层验证。
