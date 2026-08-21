# Agent Note: 自定义化为核心

Status: implemented

## Problem

发行包如果只是"装齐全家桶"，与社区个人全家桶（dsh-web-ui-all）无差异，且无法满足团队/个人差异化需求。需要明确发行包的核心价值主张。

## Decision

**核心价值 = 自定义化**：开箱即用是默认值，可自定义是核心能力。贯穿三层：

| 层 | 自定义什么 | 机制 |
| --- | --- | --- |
| 实例 | 每人创建自己的实例（personal），类型可扩展 | 实例档案 type 枚举（normal/shared/host/...） |
| UI | 每人的布局（四区可调）、插件组合（不做换肤——皮肤否决 2026-08） | dsh-my-ui 自定义框架（布局+组合） |
| 发行包 | 每团队的默认配置 + 用户覆盖 | profile 模板 + `cordis.patch.yml` 覆盖层（DSH 原生机制） |

哲学类比 oh-my-zsh：默认给你一套好用的，"my"的精髓是你可以改。

## Alternatives

- 只做"开箱即用"不做自定义——否决：与社区全家桶无差异，丢失差异化。
- 自定义做成独立 UI 配置面板插件——暂不采纳：先通过 patch 层 + 皮肤资产机制实现，配置面板属于后续 UI 增强。

## Consequences

- dsh-my-ui 定位 = 自定义 UI 平台（默认全家桶 + 组合/布局/皮肤自定义），非纯聚合。
- vendored 社区 dsh-web-ui 时**不引入皮肤中心**（皮肤否决 2026-08，功能优先）；自定义维度=布局+插件组合。
- profiles/web 模板的 cordis.patch.yml 是自定义化的主战场，默认配置要"够用且可改"。

相关：[分层架构](2026-08-21-layered-architecture.md) · [命名决策](2026-08-21-naming-decisions.md)
