# Agent Notes

记录会影响本仓库的**决策与需求文档**——代码和架构文档承载不了的 *为什么* 与 *我们放弃了什么*。每个需求/决策一个文档，随生命周期移动。

## 路径与命名

`{lifecycle}/{class}/yyyy-mm-dd-slug.md`

- **lifecycle**（顶层目录）：
  - `proposed/` — 提案中，尚未实施（或只实施了一部分）
  - `implemented/` — 已拍板并落地；**与现状保持同步**（事实层面：路径/名字/结构随代码更新，决策本身不改）
  - `rejected/` — 考虑过并否决；仅在"防止再次踩坑"时有保留价值，否则删除
  - `archived/` — 已归档；**永久冻结**，不可编辑、不作为当前权威
- **class**（二级目录，本仓库精简为三类）：
  - `architecture` — 对**交付源码**的结构决策（包如何组织、运行时词汇、分层）
  - `feature` — 新的用户/模型可见能力（需求）
  - `process` — 代码**周边**的工具/策略/流程（命名、vendoring、版本矩阵、CI）
- 文件名日期 = 首次提出日期（按 git 历史）。

## 何时写

**非平凡变更必须新增/更新至少一个 Agent Note（同一 PR/同一次提交）**。非平凡 = 改变行为、架构、跨包共享契约、流程/工具、配置或磁盘/网络格式。纯机械/局部编辑豁免。

- 一个 note 只记录**一个**决策；同一主题更新既有 note，不重复建。
- 已实施的 note 被完全取代时：保留所有独有理由/备选/后果后合并删除，修复入链；部分取代则保留并互相链接。
- **绝不把 note 改成另一个决策**——用新 note 取代，旧 note 交叉链接。

## 文件格式

```markdown
# Agent Note: <标题>

Status: implemented | proposed | rejected

## Problem        — 背景：问题、约束、为什么需要决策
## Decision       — 决策本身：定的是什么
## Alternatives   — 考虑过的备选与否决理由
## Consequences   — 后果：影响、代价、后续注意
```

note 之间用相对 markdown 链接交叉引用（`[topic](../../implemented/architecture/2026-….md)`），不用裸文字。

## 归档与删除

- 决策已完整落地且其理由不太可能指导未来工作时 → 归档到 `archived/{class}/`，插入 `Archived: YYYY-MM-DD` 行，之后永久冻结。
- 提案过时 → 直接否决（rejected），不归档 proposed。
