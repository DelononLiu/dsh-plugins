# Agent Note: 复杂内容呈现层定名 dsh-show-me（附对外叙事纠偏）

Status: implemented

## Problem

这个包（原 `dsh-plan-show`）的能力范围早已超出名字：一个 `Artifact` 模型撑 plan / verify /
completion 三类，客户端把围栏渲染成图片就地插进消息流——它服务的是"内容复杂时简化给用户看"，
不是"计划审阅"。名字却停在一个 kind（plan）上；草稿 note 里那句"包名保留（历史）"是妥协，
不是决策。

命名过程暴露三条候选轴各有陷阱：

| 轴 | 例子 | 为什么不行 |
| --- | --- | --- |
| 动作 | `dsh-show` / `dsh-show-key` / `dsh-simplify-show` | 只说了"展示"，没说清 show 什么；`show-key` 还会被读成"显示密钥"，`simplify-show` 是动词进名词位 |
| 内容 | `dsh-artifact-card` / `dsh-dossier` / `dsh-brief` | 说了东西，但要么把范围缩回判断面，要么与既有词义无关；`dsh-artifact` / `dsh-artifacts` / `dsh-showcase` 已被活跃社区包占用 |
| 形式 | `dsh-figure` / `dsh-deck` / `dsh-slideshow` | 说了形状（一张 / 一叠），但当前渲染形态就是"消息里一张图"，`deck` 会承诺并不存在的翻页 |

同时对外叙事也偏了：提示词段与工具描述写的是**审批腔**（"方案要用户拍板、验收要用户确认"），
而用户要的是"这段太复杂，给我简单化展示，我看看"。

## Decision

- **定名 `dsh-show-me`**：祈使句 + 用户视角，正是这条常驻需求的原话。`show-it` 只差一个人称，
  但它是第三人称视角（谁在看没说）；`show-me` 直接对上需求。
- **能力范围统一为"复杂内容 → 简化呈现"**：判断面（plan / verify / completion 的条目与证据）
  与理解面（把话题讲成图）共用同一 `Artifact` 模型与同一围栏，名字同时容下两者。
- **改名面**：包名与目录 `dsh-show-me`、围栏 ` ```show-me `、提示词段 `show-me:format`。
  类型 `Artifact` **不动**——内容模型叫 Artifact。（当时一并改名的工具 `show_me` 与端点
  `/api/show-me/artifacts` 已于 2026-10 删除：没有 UI 消费的产物存储是陷阱，插件收敛为
  「提示词约定 + 围栏渲染」，见 [场景与分期 note](../../proposed/feature/2026-09-13-dsh-plan-show-scenarios-and-directions.md) §14。）
- **旧围栏名 `plan-show` 保留为 legacy 别名**（`LEGACY_FENCES`）：旧会话里已落盘的围栏继续出图，
  改名的代价不转嫁给历史消息；两条测试钉住这条兼容路径。
- **对外叙事改成"复杂 → 简化 → 我看"**：提示词段标题改为「复杂内容要简化呈现（show-me）」，
  触发条件写成"内容复杂到读不下去时（长方案、多步计划、大范围改动、一堆证据）"。审批语义
  保留为 verify / completion 的增强，不再当主叙事。（当时同步改写的工具描述、`summary`
  参数说明与工具回执已随工具一并删除。）

## Alternatives

- `dsh-show`：当前能力的最短说法，但动词读法下答不出"show 什么"（用户实际使用反馈即此）。
- `dsh-show-artifact` / `dsh-artifact-show` / `dsh-artifact-card`：把 `plan` 换成代码里的真名
  `Artifact`，命名最"准"，但退回内容轴，且与 npm 上活跃的 `dsh-artifact`（0.7.0，2026-10-01）、
  `dsh-artifacts`（0.1.1）近名近义。
- `dsh-deck` / `dsh-slideshow` / `dsh-figure`：形式轴。`deck` 需先真做出"一叠"（概览/明细/证据
  多帧）才名实相符；当前形态是一个围栏一张图，故弃。
- `dsh-show-it`：与选定名只差一个人称，取用户视角者。
- `dsh-key-show` / `dsh-show-key`：`X-show` 家族里 X 必须是硬名词（`plan-show` 成立正因为 plan
  是硬词）；key 是形容词性用法，且 `show key` 会被读成"显示密钥"。`dsh-key-show` 另与 keynote
  商标擦边。
- `dsh-simplify-show`：动词进 X 位，语法不成立；"简化"是动作，两条轴都不落。
- 占用实查（2026-10-01，npm registry + GitHub API）：`dsh-show-me` / `dsh-showme` 均空；
  GitHub 无同名仓库。同名同义的只有 humanlayer 的 `show-me` skill（skill 名，非包名）。

## Consequences

- 引用旧名处同步更新：`docs/architecture.md` §5 矩阵、§8 占用表与最终命名条目、§9 实现状态表；
  [naming-decisions](2026-08-21-naming-decisions.md) 增行。
- **实例需重链**：web2（3082）的 profile `package.json` 指向旧目录路径；`profiles/` 模板与
  web / web3 / web4 / daemon 尚未登记本插件，故改名未扩散到模板。
- 历史记录保留原样（如 [upgrade-017-web5-verification](../../proposed/process/2026-09-26-upgrade-017-web5-verification.md)
  里的旧测试计数）——它们是当时的现场。
- 场景与分期草稿见 [dsh-plan-show 场景与分期](../../proposed/feature/2026-09-13-dsh-plan-show-scenarios-and-directions.md)
  （该 note 中"包名保留（历史）"一行为本 note 取代）；DOM 钩子契约见
  [消息内就地渲染](../../implemented/feature/2026-09-13-plan-show-inline-dom-hooks.md)。
